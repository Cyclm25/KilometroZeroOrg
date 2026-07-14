// server/middleware/auth.js
//
// Core security middleware:
//  - verifyAdminToken: validates the JWT stored in an httpOnly cookie,
//    rejects anything invalid/expired, and implements a SLIDING session
//    (auto-logout after N minutes of inactivity) by reissuing a fresh
//    token on every authenticated request.
//  - requireAdminRole: RBAC check - only role === 'admin' may proceed.
//
// These two are combined into a single `protectAdminRoute` used on every
// admin API route AND on the server-rendered /admin dashboard page itself,
// so typing the URL directly cannot bypass anything (unlike a client-side
// only check).

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const IDLE_MINUTES = parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || "20", 10);
const COOKIE_NAME = "admin_session";

if (!JWT_SECRET || JWT_SECRET.length < 20) {
    throw new Error("JWT_SECRET is missing or too short. Set a long random value in .env");
}

function issueToken(res, payload) {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${IDLE_MINUTES}m` });
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true, // not readable by client-side JS -> mitigates XSS token theft
        secure: process.env.COOKIE_SECURE === "true", // set true once served over HTTPS
        sameSite: "strict", // mitigates CSRF
        maxAge: IDLE_MINUTES * 60 * 1000,
        path: "/",
    });
    return token;
}

function clearToken(res) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
}

// Verifies the JWT. On success, refreshes it (sliding expiry) so an active
// admin stays logged in, while an idle admin is auto-logged-out after
// IDLE_MINUTES with no activity.
function verifyAdminToken(req, res, next) {
    const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
    if (!token) {
        return res.status(401).json({ error: "Not authenticated." });
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.admin = { id: payload.id, email: payload.email, role: payload.role, name: payload.name };
        // Sliding session: reissue a fresh token with a full new idle window.
        issueToken(res, { id: payload.id, email: payload.email, role: payload.role, name: payload.name });
        next();
    } catch (err) {
        clearToken(res);
        return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
    }
}

// RBAC: only the 'admin' role may pass, even if somehow authenticated as
// something else. Defense in depth alongside verifyAdminToken.
function requireAdminRole(req, res, next) {
    if (!req.admin || req.admin.role !== "admin") {
        return res.status(403).json({ error: "Access denied. Administrator role required." });
    }
    next();
}

const protectAdminRoute = [verifyAdminToken, requireAdminRole];

// Variant used for the server-rendered /admin page itself (as opposed to
// the JSON API). A browser navigating to /admin without a valid admin
// session gets redirected to the login page rather than a raw JSON error.
function guardAdminPage(req, res, next) {
    const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
    if (!token) return res.redirect("/admin/login");
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload.role !== "admin") {
            clearToken(res);
            return res.redirect("/admin/access-denied");
        }
        req.admin = { id: payload.id, email: payload.email, role: payload.role, name: payload.name };
        issueToken(res, req.admin);
        next();
    } catch (err) {
        clearToken(res);
        return res.redirect("/admin/login");
    }
}

module.exports = {
    issueToken,
    clearToken,
    verifyAdminToken,
    requireAdminRole,
    protectAdminRoute,
    guardAdminPage,
    COOKIE_NAME,
    IDLE_MINUTES,
};
