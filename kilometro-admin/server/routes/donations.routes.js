// server/routes/donations.routes.js
const express = require("express");
const db = require("../db/database");
const router = express.Router();

// GET /api/admin/donations?status=&campaignId=&dateFrom=&dateTo=&sort=&dir=&page=&pageSize=
router.get("/", (req, res) => {
    const { status = "", campaignId = "", dateFrom = "", dateTo = "" } = req.query;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "15", 10)));

    let where = "WHERE 1=1";
    const params = {};
    if (status) {
        where += " AND d.payment_status = @status";
        params.status = status;
    }
    if (campaignId) {
        where += " AND d.campaign_id = @campaignId";
        params.campaignId = campaignId;
    }
    if (dateFrom) {
        where += " AND date(d.created_at) >= date(@dateFrom)";
        params.dateFrom = dateFrom;
    }
    if (dateTo) {
        where += " AND date(d.created_at) <= date(@dateTo)";
        params.dateTo = dateTo;
    }

    const total = db.prepare(`SELECT COUNT(*) c FROM donations d ${where}`).get(params).c;
    const rows = db.prepare(`
        SELECT d.*, c.title AS campaign_title
        FROM donations d
        LEFT JOIN campaigns c ON c.id = d.campaign_id
        ${where}
        ORDER BY d.created_at DESC
        LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

    res.json({ data: rows, total, page, pageSize });
});

// CSV export respects the same filters
router.get("/export.csv", (req, res) => {
    const { status = "", campaignId = "", dateFrom = "", dateTo = "" } = req.query;
    let where = "WHERE 1=1";
    const params = {};
    if (status) { where += " AND d.payment_status = @status"; params.status = status; }
    if (campaignId) { where += " AND d.campaign_id = @campaignId"; params.campaignId = campaignId; }
    if (dateFrom) { where += " AND date(d.created_at) >= date(@dateFrom)"; params.dateFrom = dateFrom; }
    if (dateTo) { where += " AND date(d.created_at) <= date(@dateTo)"; params.dateTo = dateTo; }

    const rows = db.prepare(`
        SELECT d.id, d.donor_name, d.is_public, c.title AS campaign_title, d.amount,
               d.payment_status, d.payment_method, d.created_at
        FROM donations d
        LEFT JOIN campaigns c ON c.id = d.campaign_id
        ${where}
        ORDER BY d.created_at DESC
    `).all(params);

    const header = "ID,Donor Name,Public,Campaign,Amount,Status,Method,Date\n";
    const csvRows = rows.map(r => {
        const donor = r.is_public ? r.donor_name : "Anonymous";
        const safe = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        return [r.id, donor, r.is_public ? "Yes" : "No", r.campaign_title || "", r.amount, r.payment_status, r.payment_method, r.created_at]
            .map(safe).join(",");
    }).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="donations_export_${Date.now()}.csv"`);
    res.send(header + csvRows);
});

module.exports = router;
