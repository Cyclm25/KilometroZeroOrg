// server/db/database.js
// Central SQLite connection + schema setup.
// Using better-sqlite3: synchronous, fast, file-based - no separate DB server needed.

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "kilometro.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','donor','user')) DEFAULT 'user',
    status TEXT NOT NULL CHECK(status IN ('active','suspended')) DEFAULT 'active',
    is_donor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enforce at most one admin account at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_admin
    ON users(role) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    goal_amount REAL NOT NULL DEFAULT 0,
    raised_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('pending','active','completed','rejected','archived')) DEFAULT 'pending',
    created_by TEXT,
    reported_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    donor_name TEXT NOT NULL,
    donor_email TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    amount REAL NOT NULL,
    payment_status TEXT NOT NULL CHECK(payment_status IN ('successful','pending','failed')) DEFAULT 'pending',
    payment_method TEXT DEFAULT 'mock-gateway',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')) DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('new_campaign','new_donation','campaign_report','system')),
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    success INTEGER NOT NULL,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kyc_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    id_type TEXT NOT NULL,
    id_document_name TEXT NOT NULL,
    id_document_mime TEXT NOT NULL,
    id_document_ciphertext TEXT NOT NULL,
    selfie_name TEXT,
    selfie_mime TEXT,
    selfie_ciphertext TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
    rejection_reason TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
`);

function ensureColumn(tableName, columnSql) {
    const columnName = columnSql.split(/\s+/)[0];
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === columnName)) {
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`).run();
    }
}

ensureColumn("users", "email_verified INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "email_verified_at TEXT");
ensureColumn("users", "email_verification_code_hash TEXT");
ensureColumn("users", "email_verification_expires_at TEXT");
ensureColumn("users", "kyc_status TEXT NOT NULL DEFAULT 'not_started' CHECK(kyc_status IN ('not_started','pending','approved','rejected'))");
ensureColumn("users", "kyc_submitted_at TEXT");
ensureColumn("users", "kyc_reviewed_at TEXT");
ensureColumn("users", "kyc_rejection_reason TEXT");
ensureColumn("users", "donor_session_version INTEGER NOT NULL DEFAULT 0");
ensureColumn("donations", "donor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
ensureColumn("donations", "receipt_email_sent INTEGER NOT NULL DEFAULT 0");
ensureColumn("donations", "receipt_email_sent_at TEXT");
ensureColumn("donations", "receipt_email_error TEXT");

module.exports = db;
