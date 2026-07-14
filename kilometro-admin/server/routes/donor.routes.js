const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db/database");
const {
    issueDonorToken,
    clearDonorToken,
    verifyDonorToken,
    requireVerifiedEmail,
    requireKycApproved,
} = require("../middleware/auth");
const {
    encryptText,
    hashValue,
    createVerificationCode,
} = require("../utils/security");
const { sendVerificationEmail, hasSmtpConfig } = require("../utils/mailer");

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again in 15 minutes." },
});

function nowPlusMinutes(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function publicDonor(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        email_verified: !!user.email_verified,
        email_verified_at: user.email_verified_at,
        kyc_status: user.kyc_status,
        kyc_submitted_at: user.kyc_submitted_at,
        kyc_reviewed_at: user.kyc_reviewed_at,
        kyc_rejection_reason: user.kyc_rejection_reason,
    };
}

function validateDataUrl(file) {
    if (!file || typeof file.dataUrl !== "string") return null;
    const match = file.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
        mime: match[1],
        base64: match[2],
        size: Buffer.byteLength(match[2], "base64"),
    };
}

function queueVerificationEmail(email, code) {
    console.info(`[donation-verification] ${email} verification code: ${code}`);
}

router.post("/register", authLimiter, async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
    }
    if (password.length < 10) {
        return res.status(400).json({ error: "Use a password with at least 10 characters." });
    }

    const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (existing && existing.role === "admin") {
        return res.status(403).json({ error: "This email is reserved for an administrator account." });
    }
    if (existing && existing.email_verified && existing.kyc_status === "approved") {
        return res.status(409).json({ error: "This account is already verified. Please log in." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationCode = createVerificationCode();
    const codeHash = hashValue(verificationCode);
    const codeExpiresAt = nowPlusMinutes(15);

    db.prepare(`
        INSERT INTO users (
            name, email, password_hash, role, status, is_donor,
            email_verified, email_verified_at, email_verification_code_hash,
            email_verification_expires_at, kyc_status, donor_session_version
        ) VALUES (?, ?, ?, 'user', 'active', 1, 0, NULL, ?, ?, 'not_started', 0)
        ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            password_hash = excluded.password_hash,
            role = 'user',
            status = 'active',
            is_donor = 1,
            email_verified = 0,
            email_verified_at = NULL,
            email_verification_code_hash = excluded.email_verification_code_hash,
            email_verification_expires_at = excluded.email_verification_expires_at,
            kyc_status = 'not_started',
            kyc_submitted_at = NULL,
            kyc_reviewed_at = NULL,
            kyc_rejection_reason = NULL,
            donor_session_version = donor_session_version + 1
    `).run(name, email, passwordHash, codeHash, codeExpiresAt);

    try {
        await sendVerificationEmail(email, verificationCode, name);
    } catch (err) {
        if (process.env.NODE_ENV === "production" || hasSmtpConfig()) {
            return res.status(500).json({ error: err.message });
        }
        queueVerificationEmail(email, verificationCode);
    }

    const donor = db.prepare(
        `SELECT id, name, email, status, email_verified, email_verified_at, kyc_status,
                kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, donor_session_version
         FROM users WHERE email = ?`
    ).get(email);

    issueDonorToken(res, {
        id: donor.id,
        email: donor.email,
        role: "user",
        name: donor.name,
        emailVerified: 0,
        kycStatus: donor.kyc_status,
        sessionVersion: donor.donor_session_version,
    });

    db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
        "donor_registered",
        `Donor account created for ${email}`
    );

    res.json({
        success: true,
        message: "Verification code sent to your email address.",
        donor: publicDonor(donor),
        verificationCode: process.env.NODE_ENV === "production" ? undefined : verificationCode,
    });
});

router.post("/verify-email", authLimiter, (req, res) => {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || "").trim();

    if (!email || !code) {
        return res.status(400).json({ error: "Email and verification code are required." });
    }

    const donor = db.prepare("SELECT * FROM users WHERE email = ? AND role != 'admin'").get(email);
    if (!donor) {
        return res.status(404).json({ error: "No donor account found for that email." });
    }

    if (!donor.email_verification_code_hash || !donor.email_verification_expires_at) {
        if (donor.email_verified) {
            return res.json({ success: true, message: "Email already verified.", donor: publicDonor(donor) });
        }
        return res.status(400).json({ error: "Please request a new verification code." });
    }

    if (new Date(donor.email_verification_expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: "Verification code expired. Please request a new one." });
    }

    if (hashValue(code) !== donor.email_verification_code_hash) {
        return res.status(400).json({ error: "Invalid verification code." });
    }

    db.prepare(`
        UPDATE users
        SET email_verified = 1,
            email_verified_at = datetime('now'),
            email_verification_code_hash = NULL,
            email_verification_expires_at = NULL,
            donor_session_version = donor_session_version + 1
        WHERE id = ?
    `).run(donor.id);

    const verifiedDonor = db.prepare(
        `SELECT id, name, email, status, email_verified, email_verified_at, kyc_status,
                kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, donor_session_version
         FROM users WHERE id = ?`
    ).get(donor.id);

    issueDonorToken(res, {
        id: verifiedDonor.id,
        email: verifiedDonor.email,
        role: "user",
        name: verifiedDonor.name,
        emailVerified: 1,
        kycStatus: verifiedDonor.kyc_status,
        sessionVersion: verifiedDonor.donor_session_version,
    });

    db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
        "donor_email_verified",
        `Donor email verified for ${donor.email}`
    );

    res.json({ success: true, message: "Email verified successfully.", donor: publicDonor(verifiedDonor) });
});

router.post("/login", authLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    const donor = db.prepare("SELECT * FROM users WHERE email = ? AND role != 'admin'").get(email);
    const hashToCheck = donor ? donor.password_hash : "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
    const passwordMatches = await bcrypt.compare(password, hashToCheck);

    if (!donor || !passwordMatches) {
        return res.status(401).json({ error: "Invalid email or password." });
    }
    if (!donor.email_verified) {
        return res.status(403).json({ error: "Please verify your email before logging in." });
    }
    if (donor.kyc_status !== "approved") {
        return res.status(403).json({ error: donor.kyc_status === "pending" ? "KYC is still under review." : "KYC approval is required before donating." });
    }

    issueDonorToken(res, {
        id: donor.id,
        email: donor.email,
        role: donor.role,
        name: donor.name,
        emailVerified: 1,
        kycStatus: donor.kyc_status,
        sessionVersion: donor.donor_session_version,
    });

    db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
        "donor_login",
        `Donor ${donor.email} logged in`
    );

    res.json({ success: true, donor: publicDonor(donor) });
});

router.post("/logout", verifyDonorToken, (req, res) => {
    db.prepare("UPDATE users SET donor_session_version = donor_session_version + 1 WHERE id = ?").run(req.donor.id);
    clearDonorToken(res);
    db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
        "donor_logout",
        `Donor ${req.donor.email} logged out`
    );
    res.json({ success: true });
});

router.get("/me", verifyDonorToken, (req, res) => {
    const kyc = db.prepare("SELECT * FROM kyc_submissions WHERE user_id = ?").get(req.donor.id);
    res.json({ donor: publicDonor(req.donor), kyc: kyc ? { id: kyc.id, status: kyc.status, submitted_at: kyc.submitted_at, reviewed_at: kyc.reviewed_at, rejection_reason: kyc.rejection_reason } : null });
});

router.post("/kyc", verifyDonorToken, requireVerifiedEmail, (req, res) => {
    const idType = String(req.body.idType || "").trim();
    const idNumber = String(req.body.idNumber || "").trim();
    const document = req.body.document;
    const selfie = req.body.selfie;

    if (!idType || !idNumber) {
        return res.status(400).json({ error: "ID type and ID number are required." });
    }

    const idDocument = validateDataUrl(document);
    const selfieDocument = validateDataUrl(selfie);

    if (!idDocument) {
        return res.status(400).json({ error: "A valid government ID file is required." });
    }
    if (!selfieDocument) {
        return res.status(400).json({ error: "A selfie file is required for identity verification." });
    }

    const maxSizeBytes = 5 * 1024 * 1024;
    if (idDocument.size > maxSizeBytes || selfieDocument.size > maxSizeBytes) {
        return res.status(400).json({ error: "Each file must be 5 MB or smaller." });
    }

    const allowedMimeTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);
    if (!allowedMimeTypes.has(idDocument.mime) || !["image/jpeg", "image/png"].includes(selfieDocument.mime)) {
        return res.status(400).json({ error: "Government ID must be a JPG, PNG, or PDF; selfie must be JPG or PNG." });
    }

    const payload = {
        idType,
        idNumber,
        document: {
            name: document.name || "government-id",
            mime: idDocument.mime,
            dataUrl: document.dataUrl,
        },
        selfie: {
            name: selfie.name || "selfie",
            mime: selfieDocument.mime,
            dataUrl: selfie.dataUrl,
        },
        submittedBy: req.donor.email,
    };

    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare(`
            INSERT INTO kyc_submissions (
                user_id, id_type, id_document_name, id_document_mime, id_document_ciphertext,
                selfie_name, selfie_mime, selfie_ciphertext, status, rejection_reason, submitted_at, reviewed_at, reviewed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL)
            ON CONFLICT(user_id) DO UPDATE SET
                id_type = excluded.id_type,
                id_document_name = excluded.id_document_name,
                id_document_mime = excluded.id_document_mime,
                id_document_ciphertext = excluded.id_document_ciphertext,
                selfie_name = excluded.selfie_name,
                selfie_mime = excluded.selfie_mime,
                selfie_ciphertext = excluded.selfie_ciphertext,
                status = 'pending',
                rejection_reason = NULL,
                submitted_at = excluded.submitted_at,
                reviewed_at = NULL,
                reviewed_by = NULL
        `).run(
            req.donor.id,
            idType,
            document.name || "government-id",
            idDocument.mime,
            encryptText(JSON.stringify({ ...payload, document: payload.document, selfie: payload.selfie, idNumber })),
            selfie.name || "selfie",
            selfieDocument.mime,
            encryptText(JSON.stringify(payload)),
            now
        );

        db.prepare(`
            UPDATE users
            SET kyc_status = 'pending',
                kyc_submitted_at = datetime('now'),
                kyc_reviewed_at = NULL,
                kyc_rejection_reason = NULL,
                is_donor = 1,
                donor_session_version = donor_session_version + 1
            WHERE id = ?
        `).run(req.donor.id);

        db.prepare("INSERT INTO notifications (type, message, is_read) VALUES ('system', ?, 0)").run(
            `New KYC submission received from ${req.donor.email}`
        );
        db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
            "donor_kyc_submitted",
            `KYC submitted for ${req.donor.email}`
        );
    })();

    const updatedDonor = db.prepare("SELECT * FROM users WHERE id = ?").get(req.donor.id);
    issueDonorToken(res, {
        id: updatedDonor.id,
        email: updatedDonor.email,
        role: updatedDonor.role,
        name: updatedDonor.name,
        emailVerified: 1,
        kycStatus: updatedDonor.kyc_status,
        sessionVersion: updatedDonor.donor_session_version,
    });

    res.json({ success: true, message: "KYC submission received. Review is pending.", donor: publicDonor(updatedDonor) });
});

router.post("/donations", verifyDonorToken, requireKycApproved, (req, res) => {
    const amount = Number(req.body.amount || 0);
    const campaignId = req.body.campaignId ? Number(req.body.campaignId) : null;
    const note = String(req.body.note || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "A valid donation amount is required." });
    }

    if (campaignId) {
        const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found." });
        }
    }

    const insertDonation = db.prepare(`
        INSERT INTO donations (campaign_id, donor_user_id, donor_name, donor_email, is_public, amount, payment_status, payment_method)
        VALUES (?, ?, ?, ?, 1, ?, 'successful', 'Verified Portal')
    `);

    const transaction = db.transaction(() => {
        const donation = insertDonation.run(campaignId, req.donor.id, req.donor.name, req.donor.email, amount);
        if (campaignId) {
            db.prepare("UPDATE campaigns SET raised_amount = raised_amount + ? , updated_at = datetime('now') WHERE id = ?").run(amount, campaignId);
        }
        db.prepare("INSERT INTO notifications (type, message, is_read) VALUES ('new_donation', ?, 0)").run(
            `Verified donor ${req.donor.name} donated ₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`
        );
        db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
            "verified_donation_created",
            `Verified donation of ₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })} by ${req.donor.email}${note ? ` (${note})` : ""}`
        );
        return donation;
    });

    const result = transaction();
    res.json({ success: true, donationId: result.lastInsertRowid });
});

module.exports = router;