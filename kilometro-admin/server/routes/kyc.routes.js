const express = require("express");
const db = require("../db/database");
const { decryptText } = require("../utils/security");

const router = express.Router();

function maskIdNumber(idNumber) {
    const clean = String(idNumber || "");
    if (clean.length <= 4) return clean;
    return `${clean.slice(0, 2)}${"•".repeat(Math.max(0, clean.length - 4))}${clean.slice(-2)}`;
}

function parseStoredSubmission(row) {
    let documentPayload = null;
    let selfiePayload = null;
    let idNumber = "";
    try {
        const decodedDocument = JSON.parse(decryptText(row.id_document_ciphertext));
        documentPayload = decodedDocument.document || null;
        selfiePayload = decodedDocument.selfie || null;
        idNumber = decodedDocument.idNumber || "";
    } catch (err) {
        documentPayload = null;
    }

    return {
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        email: row.email,
        id_type: row.id_type,
        id_number_masked: maskIdNumber(idNumber),
        status: row.status,
        rejection_reason: row.rejection_reason,
        submitted_at: row.submitted_at,
        reviewed_at: row.reviewed_at,
        reviewed_by: row.reviewed_by,
        document: documentPayload,
        selfie: selfiePayload,
    };
}

router.get("/", (req, res) => {
    const { status = "", search = "" } = req.query;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || "10", 10)));

    let where = "WHERE 1=1";
    const params = {};
    if (status) {
        where += " AND k.status = @status";
        params.status = status;
    }
    if (search) {
        where += " AND (u.name LIKE @search OR u.email LIKE @search)";
        params.search = `%${search}%`;
    }

    const total = db.prepare(`
        SELECT COUNT(*) c
        FROM kyc_submissions k
        JOIN users u ON u.id = k.user_id
        ${where}
    `).get(params).c;

    const rows = db.prepare(`
        SELECT k.id, k.user_id, u.name, u.email, u.email_verified, u.kyc_status,
               k.status, k.submitted_at, k.reviewed_at, k.reviewed_by, k.rejection_reason
        FROM kyc_submissions k
        JOIN users u ON u.id = k.user_id
        ${where}
        ORDER BY k.submitted_at DESC
        LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

    res.json({ data: rows, total, page, pageSize });
});

router.get("/:id", (req, res) => {
    const row = db.prepare(`
        SELECT k.*, u.name, u.email
        FROM kyc_submissions k
        JOIN users u ON u.id = k.user_id
        WHERE k.id = ?
    `).get(req.params.id);

    if (!row) {
        return res.status(404).json({ error: "KYC submission not found." });
    }

    res.json({ submission: parseStoredSubmission(row) });
});

router.post("/:id/approve", (req, res) => {
    const submission = db.prepare("SELECT * FROM kyc_submissions WHERE id = ?").get(req.params.id);
    if (!submission) {
        return res.status(404).json({ error: "KYC submission not found." });
    }

    db.transaction(() => {
        db.prepare(`
            UPDATE kyc_submissions
            SET status = 'approved',
                rejection_reason = NULL,
                reviewed_at = datetime('now'),
                reviewed_by = ?
            WHERE id = ?
        `).run(req.admin.id, submission.id);

        db.prepare(`
            UPDATE users
            SET kyc_status = 'approved',
                kyc_reviewed_at = datetime('now'),
                kyc_rejection_reason = NULL,
                donor_session_version = donor_session_version + 1
            WHERE id = ?
        `).run(submission.user_id);

        db.prepare("INSERT INTO notifications (type, message, is_read) VALUES ('system', ?, 0)").run(
            `KYC approved for user ID ${submission.user_id}`
        );
        db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
            "kyc_approved",
            `KYC approved by ${req.admin.email} for user ID ${submission.user_id}`
        );
    })();

    res.json({ success: true });
});

router.post("/:id/reject", (req, res) => {
    const reason = String(req.body.reason || "").trim();
    const submission = db.prepare("SELECT * FROM kyc_submissions WHERE id = ?").get(req.params.id);
    if (!submission) {
        return res.status(404).json({ error: "KYC submission not found." });
    }
    if (!reason) {
        return res.status(400).json({ error: "A rejection reason is required." });
    }

    db.transaction(() => {
        db.prepare(`
            UPDATE kyc_submissions
            SET status = 'rejected',
                rejection_reason = ?,
                reviewed_at = datetime('now'),
                reviewed_by = ?
            WHERE id = ?
        `).run(reason, req.admin.id, submission.id);

        db.prepare(`
            UPDATE users
            SET kyc_status = 'rejected',
                kyc_reviewed_at = datetime('now'),
                kyc_rejection_reason = ?,
                donor_session_version = donor_session_version + 1
            WHERE id = ?
        `).run(reason, submission.user_id);

        db.prepare("INSERT INTO notifications (type, message, is_read) VALUES ('system', ?, 0)").run(
            `KYC rejected for user ID ${submission.user_id}`
        );
        db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
            "kyc_rejected",
            `KYC rejected by ${req.admin.email} for user ID ${submission.user_id}`
        );
    })();

    res.json({ success: true });
});

module.exports = router;