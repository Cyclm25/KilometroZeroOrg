// server/routes/campaigns.routes.js
const express = require("express");
const db = require("../db/database");
const router = express.Router();

async function logActivity(action, details) {
    await db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(action, details);
}

// GET /api/admin/campaigns?search=&status=&sort=created_at&dir=desc&page=1&pageSize=10
router.get("/", async (req, res) => {
    const { search = "", status = "", sort = "created_at", dir = "desc" } = req.query;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || "10", 10)));

    const allowedSort = ["created_at", "title", "goal_amount", "raised_amount", "status"];
    const sortCol = allowedSort.includes(sort) ? sort : "created_at";
    const sortDir = dir.toLowerCase() === "asc" ? "ASC" : "DESC";

    let where = "WHERE 1=1";
    const params = {};
    if (search) {
        where += " AND (title LIKE @search OR description LIKE @search)";
        params.search = `%${search}%`;
    }
    if (status) {
        where += " AND status = @status";
        params.status = status;
    }

    const total = (await db.prepare(`SELECT COUNT(*) c FROM campaigns ${where}`).get(params)).c;
    const rows = await db.prepare(`
        SELECT * FROM campaigns ${where}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

    res.json({ data: rows, total, page, pageSize });
});

router.get("/:id", async (req, res) => {
    const campaign = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    const donations = await db.prepare(
        "SELECT * FROM donations WHERE campaign_id = ? ORDER BY created_at DESC"
    ).all(req.params.id);
    res.json({ campaign, donations });
});

router.patch("/:id", async (req, res) => {
    const campaign = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });

    const fields = ["title", "description", "category", "goal_amount"];
    const updates = [];
    const values = [];
    for (const f of fields) {
        if (req.body[f] !== undefined) {
            updates.push(`${f} = ?`);
            values.push(req.body[f]);
        }
    }
    if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update." });

    values.push(req.params.id);
    await db.prepare(`UPDATE campaigns SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...values);
    await logActivity("campaign_edited", `Campaign #${req.params.id} ("${campaign.title}") edited by ${req.admin.email}`);
    res.json({ success: true });
});

router.post("/:id/approve", async (req, res) => {
    const campaign = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    await db.prepare("UPDATE campaigns SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    await logActivity("campaign_approved", `"${campaign.title}" approved by ${req.admin.email}`);
    res.json({ success: true });
});

router.post("/:id/reject", async (req, res) => {
    const campaign = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    await db.prepare("UPDATE campaigns SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    await logActivity("campaign_rejected", `"${campaign.title}" rejected by ${req.admin.email}`);
    res.json({ success: true });
});

router.post("/:id/archive", async (req, res) => {
    const campaign = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    await db.prepare("UPDATE campaigns SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    await logActivity("campaign_archived", `"${campaign.title}" archived by ${req.admin.email}`);
    res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
    const campaign = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    await db.prepare("DELETE FROM campaigns WHERE id = ?").run(req.params.id);
    await logActivity("campaign_deleted", `"${campaign.title}" deleted by ${req.admin.email}`);
    res.json({ success: true });
});

module.exports = router;