// server/db/seedAdmin.js
//
// This is the ONLY mechanism in the entire application that can create an
// admin account. There is no public or authenticated "register as admin"
// API route anywhere in server/routes.
//
// Can be used two ways:
//   1. CLI:  npm run seed:admin        (exits the process when done)
//   2. Imported at server startup:  require("./db/seedAdmin")()   (does NOT exit)
//
// It reads credentials from .env, hashes the password with bcrypt, and
// inserts (or updates) the single admin row. The database also enforces
// "only one admin" with a UNIQUE partial index (see database.js).

require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./database");

async function seedAdmin() {
    await db.initDb();

    const name = process.env.ADMIN_NAME || "Site Administrator";
    const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "";

    if (!email || !password) {
        console.error("[seedAdmin] ADMIN_EMAIL and ADMIN_PASSWORD must be set before seeding.");
        return;
    }
    if (password.length < 10) {
        console.error("[seedAdmin] ADMIN_PASSWORD is too short. Use at least 10 characters, mixing case/numbers/symbols.");
        return;
    }

    const existingAdmin = await db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
    const passwordHash = await bcrypt.hash(password, 12);

    if (existingAdmin) {
        await db.prepare(
            `UPDATE users SET name = ?, email = ?, password_hash = ?, status = 'active' WHERE id = ?`
        ).run(name, email, passwordHash, existingAdmin.id);
        console.log(`[seedAdmin] Existing admin account updated: ${email}`);
    } else {
        await db.prepare(
            `INSERT INTO users (name, email, password_hash, role, status)
             VALUES (?, ?, ?, 'admin', 'active')`
        ).run(name, email, passwordHash);
        console.log(`[seedAdmin] Admin account created: ${email}`);
    }
}

// If run directly via `npm run seed:admin`, behave like a CLI script (log + exit).
if (require.main === module) {
    seedAdmin()
        .then(() => {
            console.log("Done. You can now log in at /admin/login with these credentials.");
            process.exit(0);
        })
        .catch((err) => {
            console.error("Failed to seed admin:", err);
            process.exit(1);
        });
}

module.exports = seedAdmin;