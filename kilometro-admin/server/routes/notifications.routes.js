// server/routes/notifications.routes.js
const express = require("express");
const db = require("../db/database");
const router = express.Router();

router.get("/", (req, res) => {
    const notifications = db.prepare(
        "SELECT * FROM notifications ORDER BY created_at DESC LIMIT 30"
    ).all();
    const unreadCount = db.prepare("SELECT COUNT(*) c FROM notifications WHERE is_read = 0").get().c;
    res.json({ notifications, unreadCount });
});

router.post("/:id/read", (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(req.params.id);
    res.json({ success: true });
});

router.post("/read-all", (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1").run();
    res.json({ success: true });
});

module.exports = router;
