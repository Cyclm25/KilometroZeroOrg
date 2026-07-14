// server/routes/users.routes.js
const express = require("express");
const db = require("../db/database");
const router = express.Router();

function logActivity(action, details) {
    db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(action, details);
}

router.get("/", (req, res) => {
    const { search = "", status = "" } = req.query;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || "10", 10)));

    let where = "WHERE role != 'admin'";
    const params = {};
    if (search) {
        where += " AND (name LIKE @search OR email LIKE @search)";
        params.search = `%${search}%`;
    }
    if (status) {
        where += " AND status = @status";
        params.status = status;
    }

    const total = db.prepare(`SELECT COUNT(*) c FROM users ${where}`).get(params).c;
    const rows = db.prepare(`
        SELECT id, name, email, role, status, is_donor, created_at FROM users
        ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

    res.json({ data: rows, total, page, pageSize });
});

router.get("/:id", (req, res) => {
    const user = db.prepare(
        "SELECT id, name, email, role, status, is_donor, created_at FROM users WHERE id = ? AND role != 'admin'"
    ).get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    const donations = db.prepare(
        "SELECT * FROM donations WHERE donor_email = ? ORDER BY created_at DESC"
    ).all(user.email);

    res.json({ user, donations });
});

router.post("/:id/suspend", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin'").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(req.params.id);
    logActivity("user_suspended", `${user.email} suspended by ${req.admin.email}`);
    res.json({ success: true });
});

router.post("/:id/reactivate", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin'").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
    logActivity("user_reactivated", `${user.email} reactivated by ${req.admin.email}`);
    res.json({ success: true });
});

router.delete("/:id", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin'").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
    logActivity("user_deleted", `${user.email} deleted by ${req.admin.email}`);
    res.json({ success: true });
});

module.exports = router;
