// server/routes/notifications.routes.js
const express = require("express");
const db = require("../db/database");
const router = express.Router();

router.get("/", async (req, res) => {
    const notifications = await db.prepare(
        "SELECT * FROM notifications ORDER BY created_at DESC LIMIT 30"
    ).all();
    const unreadCount = (await db.prepare("SELECT COUNT(*) c FROM notifications WHERE is_read = 0").get()).c;
    res.json({ notifications, unreadCount });
});

router.post("/:id/read", async (req, res) => {
    await db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(req.params.id);
    res.json({ success: true });
});

router.post("/read-all", async (req, res) => {
    await db.prepare("UPDATE notifications SET is_read = 1").run();
    res.json({ success: true });
});

module.exports = router;