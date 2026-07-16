// server/db/database.js
//
// Was: local SQLite file via better-sqlite3 (synchronous, wiped on every
// Render redeploy since Render's free tier has an ephemeral filesystem).
// Now: Turso (hosted libSQL, SQLite-compatible), which survives redeploys,
// restarts, and free-tier spin-downs because it lives outside Render entirely.
//
// IMPORTANT BEHAVIOR CHANGE: every db.prepare(...).get()/.all()/.run() call
// is now ASYNC. Every call site across the app must use `await`, and every
// route handler / middleware that touches the database must be `async`.
//
// Required env vars:
//   TURSO_DATABASE_URL - from `turso db show <name> --url` (starts with libsql://)
//   TURSO_AUTH_TOKEN   - from `turso db tokens create <name>`

const { createClient } = require("@libsql/client");

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// better-sqlite3 lets you call .get(a, b, c) (positional) OR .get({named: 1})
// (named params). libSQL's execute() takes a single `args` value that is
// either an array (positional) or a plain object (named) - so we just need
// to figure out which shape the caller used and pass it straight through.
function normalizeArgs(rawArgs) {
    if (rawArgs.length === 1 && rawArgs[0] !== null && typeof rawArgs[0] === "object" && !Array.isArray(rawArgs[0])) {
        return rawArgs[0];
    }
    return rawArgs;
}

// better-sqlite3's .run() returns { lastInsertRowid, changes }. libSQL's
// execute() returns { lastInsertRowid: BigInt, rowsAffected }. Convert so
// existing call sites (which expect plain numbers) keep working unchanged.
function wrapRunResult(result) {
    return {
        lastInsertRowid: result.lastInsertRowid !== undefined && result.lastInsertRowid !== null
            ? Number(result.lastInsertRowid)
            : undefined,
        changes: result.rowsAffected,
    };
}

function makeStatement(sql, executor) {
    return {
        async get(...args) {
            const result = await executor({ sql, args: normalizeArgs(args) });
            return result.rows[0];
        },
        async all(...args) {
            const result = await executor({ sql, args: normalizeArgs(args) });
            return result.rows;
        },
        async run(...args) {
            const result = await executor({ sql, args: normalizeArgs(args) });
            return wrapRunResult(result);
        },
    };
}

function prepare(sql) {
    return makeStatement(sql, (stmt) => client.execute(stmt));
}

// Replaces better-sqlite3's synchronous `db.transaction(fn)()` pattern.
// Usage is now: `await db.transaction(async (tx) => { await tx.prepare(...).run(...); })();`
// - fn receives a transaction-scoped db-like object (with its own .prepare()).
// - Use `tx.prepare(...)` (NOT the outer `db.prepare(...)`) for every call
//   inside the callback, so those statements run inside the same transaction.
function transaction(fn) {
    return async (...fnArgs) => {
        const tx = await client.transaction("write");
        const txDb = { prepare: (sql) => makeStatement(sql, (stmt) => tx.execute(stmt)) };
        try {
            const result = await fn(txDb, ...fnArgs);
            await tx.commit();
            return result;
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    };
}

async function ensureColumn(tableName, columnSql) {
    const columnName = columnSql.split(/\s+/)[0];
    // pragma_table_info is a regular table-valued function (unlike the PRAGMA
    // statement form), so it works fine over libSQL's query protocol.
    // tableName is always a hardcoded literal from the ensureColumn() calls
    // below, never user input, so string interpolation here is safe.
    const result = await client.execute(`SELECT name FROM pragma_table_info('${tableName}')`);
    const exists = result.rows.some((row) => row.name === columnName);
    if (!exists) {
        await client.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
    }
}

let initPromise = null;

// Creates all tables/columns if they don't already exist. Safe to call
// every time the app starts - CREATE TABLE IF NOT EXISTS and ensureColumn()
// are both idempotent. Must be awaited once before the app starts handling
// requests (see index.js and seedAdmin.js).
function initDb() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        await client.execute("PRAGMA foreign_keys = ON");

        await client.executeMultiple(`
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

        await ensureColumn("users", "email_verified INTEGER NOT NULL DEFAULT 0");
        await ensureColumn("users", "email_verified_at TEXT");
        await ensureColumn("users", "email_verification_code_hash TEXT");
        await ensureColumn("users", "email_verification_expires_at TEXT");
        await ensureColumn("users", "kyc_status TEXT NOT NULL DEFAULT 'not_started' CHECK(kyc_status IN ('not_started','pending','approved','rejected'))");
        await ensureColumn("users", "kyc_submitted_at TEXT");
        await ensureColumn("users", "kyc_reviewed_at TEXT");
        await ensureColumn("users", "kyc_rejection_reason TEXT");
        await ensureColumn("users", "donor_session_version INTEGER NOT NULL DEFAULT 0");
        await ensureColumn("donations", "donor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
        await ensureColumn("donations", "receipt_email_sent INTEGER NOT NULL DEFAULT 0");
        await ensureColumn("donations", "receipt_email_sent_at TEXT");
        await ensureColumn("donations", "receipt_email_error TEXT");
        await ensureColumn("donations", "paymongo_checkout_session_id TEXT");
        await ensureColumn("donations", "paymongo_payment_id TEXT");
    })();

    return initPromise;
}

module.exports = { prepare, transaction, initDb };