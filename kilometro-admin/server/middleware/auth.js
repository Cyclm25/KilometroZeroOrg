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
const db = require("../db/database");
const { secureCookieOptions } = require("../utils/security");

const JWT_SECRET = process.env.JWT_SECRET;
const IDLE_MINUTES = parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || "20", 10);
const DONOR_SESSION_DAYS = parseInt(process.env.DONOR_SESSION_DAYS || "7", 10);
const COOKIE_NAME = "admin_session";
const DONOR_COOKIE_NAME = "donor_session";

if (!JWT_SECRET || JWT_SECRET.length < 20) {
    throw new Error("JWT_SECRET is missing or too short. Set a long random value in .env");
}

function issueToken(res, payload) {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${IDLE_MINUTES}m` });
    res.cookie(COOKIE_NAME, token, secureCookieOptions(IDLE_MINUTES * 60 * 1000));
    return token;
}

function issueDonorToken(res, payload) {
    const maxAgeMs = DONOR_SESSION_DAYS * 24 * 60 * 60 * 1000;
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${DONOR_SESSION_DAYS}d` });
    res.cookie(DONOR_COOKIE_NAME, token, secureCookieOptions(maxAgeMs));
    return token;
}

function clearToken(res) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
}

function clearDonorToken(res) {
    res.clearCookie(DONOR_COOKIE_NAME, { path: "/" });
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

async function verifyDonorToken(req, res, next) {
    const token = req.cookies ? req.cookies[DONOR_COOKIE_NAME] : null;
    if (!token) {
        return res.status(401).json({ error: "Not authenticated." });
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await db.prepare(
            `SELECT id, name, email, role, status, is_donor, email_verified, email_verified_at,
                    kyc_status, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, donor_session_version
             FROM users WHERE id = ? AND role != 'admin'`
        ).get(payload.id);

        if (!user || user.status !== "active") {
            clearDonorToken(res);
            return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
        }

        if (typeof payload.sessionVersion === "number" && payload.sessionVersion !== user.donor_session_version) {
            clearDonorToken(res);
            return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
        }

        req.donor = user;
        issueDonorToken(res, {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
            emailVerified: user.email_verified ? 1 : 0,
            kycStatus: user.kyc_status,
            sessionVersion: user.donor_session_version,
        });
        next();
    } catch (err) {
        clearDonorToken(res);
        return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
    }
}

function requireVerifiedEmail(req, res, next) {
    if (!req.donor || !req.donor.email_verified) {
        return res.status(403).json({ error: "Email verification is required before submitting KYC." });
    }
    next();
}

function requireKycApproved(req, res, next) {
    if (!req.donor || req.donor.kyc_status !== "approved") {
        return res.status(403).json({ error: "Only KYC-approved donors can make donations." });
    }
    next();
}

module.exports = {
    issueToken,
    issueDonorToken,
    clearToken,
    clearDonorToken,
    verifyAdminToken,
    requireAdminRole,
    protectAdminRoute,
    guardAdminPage,
    verifyDonorToken,
    requireVerifiedEmail,
    requireKycApproved,
    COOKIE_NAME,
    DONOR_COOKIE_NAME,
    IDLE_MINUTES,
    DONOR_SESSION_DAYS,
};