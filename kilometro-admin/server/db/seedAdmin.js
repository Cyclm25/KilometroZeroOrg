// server/db/seedAdmin.js
//
// This is the ONLY mechanism in the entire application that can create an
// admin account. There is no public or authenticated "register as admin"
// API route anywhere in server/routes. Run manually:
//
//   npm run seed:admin
//
// It reads credentials from .env, hashes the password with bcrypt, and
// inserts (or updates) the single admin row. The database also enforces
// "only one admin" with a UNIQUE partial index (see database.js).

require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./database");

async function seedAdmin() {
    const name = process.env.ADMIN_NAME || "Site Administrator";
    const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "";

    if (!email || !password) {
        console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env before seeding.");
        process.exit(1);
    }
    if (password.length < 10) {
        console.error("ADMIN_PASSWORD is too short. Use at least 10 characters, mixing case/numbers/symbols.");
        process.exit(1);
    }

    const existingAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
    const passwordHash = await bcrypt.hash(password, 12);

    if (existingAdmin) {
        // Update the existing (and only) admin instead of creating a second one.
        db.prepare(
            `UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?`
        ).run(name, email, passwordHash, existingAdmin.id);
        console.log(`Existing admin account updated: ${email}`);
    } else {
        db.prepare(
            `INSERT INTO users (name, email, password_hash, role, status)
             VALUES (?, ?, ?, 'admin', 'active')`
        ).run(name, email, passwordHash);
        console.log(`Admin account created: ${email}`);
    }

    console.log("Done. You can now log in at /admin/login with these credentials.");
    process.exit(0);
}

seedAdmin().catch((err) => {
    console.error("Failed to seed admin:", err);
    process.exit(1);
});
