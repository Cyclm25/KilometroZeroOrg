// server/index.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { verifyAdminToken, requireAdminRole, guardAdminPage } = require("./middleware/auth");
const authRoutes = require("./routes/auth.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const campaignsRoutes = require("./routes/campaigns.routes");
const donationsRoutes = require("./routes/donations.routes");
const usersRoutes = require("./routes/users.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const donorRoutes = require("./routes/donor.routes");
const kycRoutes = require("./routes/kyc.routes");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1); // needed for correct req.ip behind a reverse proxy (rate limiting)

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
        },
    },
}));
app.use(express.json({ limit: "15mb" }));
app.use(cookieParser());

// ---------------------------------------------------------------------
// PUBLIC WEBSITE (your existing donation site) - completely separate
// from the admin system, no auth required.
// ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "..", "public", "site")));

// ---------------------------------------------------------------------
// ADMIN AUTH API (login/logout/me) - public endpoint for login itself,
// everything else behind it requires a valid admin session.
// ---------------------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/donors", donorRoutes);

// ---------------------------------------------------------------------
// PROTECTED ADMIN API - every route below requires a valid JWT AND the
// 'admin' role (RBAC). This is enforced server-side, so it cannot be
// bypassed by hiding buttons or guessing URLs.
// ---------------------------------------------------------------------
app.use("/api/admin/dashboard", verifyAdminToken, requireAdminRole, dashboardRoutes);
app.use("/api/admin/campaigns", verifyAdminToken, requireAdminRole, campaignsRoutes);
app.use("/api/admin/donations", verifyAdminToken, requireAdminRole, donationsRoutes);
app.use("/api/admin/users", verifyAdminToken, requireAdminRole, usersRoutes);
app.use("/api/admin/notifications", verifyAdminToken, requireAdminRole, notificationsRoutes);
app.use("/api/admin/kyc", verifyAdminToken, requireAdminRole, kycRoutes);

// ---------------------------------------------------------------------
// ADMIN PAGES - gated at the SERVER level (not just client-side JS), so
// manually typing /admin in the URL bar without a valid session redirects
// to the login page instead of ever sending the dashboard HTML.
// ---------------------------------------------------------------------
const adminPublicDir = path.join(__dirname, "..", "public", "admin");
app.use("/admin/assets", express.static(path.join(adminPublicDir, "css")));
app.use("/admin/js", express.static(path.join(adminPublicDir, "js")));

app.get("/admin/login", (req, res) => {
    res.sendFile(path.join(adminPublicDir, "login.html"));
});

app.get(["/donate", "/donate.html"], (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "site", "donate.html"));
});

app.get(["/admin", "/admin/dashboard"], guardAdminPage, (req, res) => {
    res.sendFile(path.join(adminPublicDir, "dashboard.html"));
});

// Any admin-area request that fails auth ends up here instead of leaking
// any dashboard markup or data.
app.get("/admin/access-denied", (req, res) => {
    res.status(403).sendFile(path.join(adminPublicDir, "access-denied.html"));
});

app.listen(PORT, () => {
    console.log(`Kilometro Zero server running on http://localhost:${PORT}`);
    console.log(`Public site:      http://localhost:${PORT}/`);
    console.log(`Admin login:      http://localhost:${PORT}/admin/login`);
});
