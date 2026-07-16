// server/routes/auth.routes.js
//
// NOTE: There is deliberately NO "register" or "signup" route here.
// The only way an admin account can exist is via `npm run seed:admin`.

const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db/database");
const { issueToken, clearToken, verifyAdminToken } = require("../middleware/auth");

const router = express.Router();

// Throttle login attempts to blunt brute-force/credential-stuffing attacks.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

async function logAttempt(email, success, ip) {
    await db.prepare(
        "INSERT INTO login_attempts (email, success, ip) VALUES (?, ?, ?)"
    ).run(email, success ? 1 : 0, ip);
}

router.post("/login", loginLimiter, async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    // Always compare against a hash (even a dummy one) to avoid leaking via timing
    // whether the email exists, and always return the same generic error.
    const hashToCheck = user ? user.password_hash : "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
    const passwordMatches = await bcrypt.compare(password, hashToCheck);

    const isValidAdmin = !!user && passwordMatches && user.role === "admin" && user.status === "active";

    await logAttempt(email, isValidAdmin, req.ip);

    if (!isValidAdmin) {
        return res.status(401).json({ error: "Invalid credentials or insufficient privileges." });
    }

    issueToken(res, { id: user.id, email: user.email, role: user.role, name: user.name });

    await db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
        "admin_login",
        `Administrator ${user.email} logged in`
    );

    res.json({ success: true, admin: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post("/logout", verifyAdminToken, async (req, res) => {
    clearToken(res);
    await db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
        "admin_logout",
        `Administrator ${req.admin.email} logged out`
    );
    res.json({ success: true });
});

// Used by the dashboard frontend to check if the current session is valid,
// and to know when to show the auto-logout warning / redirect to login.
router.get("/me", verifyAdminToken, (req, res) => {
    res.json({ admin: req.admin, idleTimeoutMinutes: require("../middleware/auth").IDLE_MINUTES });
});

module.exports = router;

