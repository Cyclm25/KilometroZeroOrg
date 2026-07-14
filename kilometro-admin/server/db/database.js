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
`);

module.exports = db;
