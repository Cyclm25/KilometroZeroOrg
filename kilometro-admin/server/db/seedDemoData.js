// server/db/seedDemoData.js
//
// Populates the dashboard with realistic MOCK data so the UI is fully
// demonstrable before the real payment gateway is integrated. Safe to run
// multiple times (it clears and re-inserts only non-admin demo rows).
// Never touches the admin account.

require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./database");
const { encryptText } = require("../utils/security");

async function seed() {
    db.prepare("DELETE FROM donations").run();
    db.prepare("DELETE FROM withdrawals").run();
    db.prepare("DELETE FROM notifications").run();
    db.prepare("DELETE FROM activity_log").run();
    db.prepare("DELETE FROM campaigns").run();
    db.prepare("DELETE FROM users WHERE role != 'admin'").run();

    const passwordHash = await bcrypt.hash("DemoPassword123!", 10);
    const insertUser = db.prepare(`
        INSERT INTO users (
            name, email, password_hash, role, status, is_donor,
            email_verified, email_verified_at, kyc_status, kyc_submitted_at, kyc_reviewed_at, created_at
        )
        VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);

    const demoUsers = [
        ["Maria Santos", "maria.santos@example.com", "active", 1, 1, "-40 days", "approved"],
        ["Juan Dela Cruz", "juan.delacruz@example.com", "active", 1, 1, "-35 days", "approved"],
        ["Angela Reyes", "angela.reyes@example.com", "active", 0, 1, "-30 days", "not_started"],
        ["Mark Villanueva", "mark.villanueva@example.com", "suspended", 1, 1, "-28 days", "rejected"],
        ["Krystel Ramos", "krystel.ramos@example.com", "active", 1, 1, "-20 days", "pending"],
        ["Paolo Fernandez", "paolo.fernandez@example.com", "active", 0, 0, "-15 days", "not_started"],
        ["Nicole Aquino", "nicole.aquino@example.com", "active", 1, 1, "-10 days", "approved"],
        ["Ramon Torres", "ramon.torres@example.com", "active", 1, 1, "-5 days", "approved"],
    ];
    for (const u of demoUsers) {
        const createdAtOffset = u[5];
        const isVerified = u[4];
        const kycStatus = u[6];
        const verifiedAt = isVerified ? createdAtOffset : null;
        const submittedAt = kycStatus === "not_started" ? null : createdAtOffset;
        const reviewedAt = ["approved", "rejected"].includes(kycStatus) ? createdAtOffset : null;
        insertUser.run(u[0], u[1], passwordHash, u[2], u[3], isVerified, verifiedAt, kycStatus, submittedAt, reviewedAt, u[5]);
    }

    const demoImage = (label) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f5efe8"/><rect x="70" y="70" width="1060" height="660" rx="34" fill="#ffffff" stroke="#d8cec5"/><text x="120" y="180" font-family="Arial" font-size="48" fill="#a00021">${label}</text><text x="120" y="250" font-family="Arial" font-size="26" fill="#555">Demo KYC document preview</text></svg>`).toString("base64")}`;
    const kycRows = [
        ["maria.santos@example.com", "passport", "A1234567", "Passport", "approved"],
        ["krystel.ramos@example.com", "national_id", "NID-2048", "National ID", "pending"],
        ["mark.villanueva@example.com", "driver_license", "D-778899", "Driver License", "rejected"],
    ];
    const userLookup = db.prepare("SELECT id, email FROM users WHERE email = ?");
    const insertKyc = db.prepare(`
        INSERT INTO kyc_submissions (
            user_id, id_type, id_document_name, id_document_mime, id_document_ciphertext,
            selfie_name, selfie_mime, selfie_ciphertext, status, rejection_reason, submitted_at, reviewed_at, reviewed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), NULL)
    `);
    for (const [email, idType, idNumber, documentLabel, status] of kycRows) {
        const user = userLookup.get(email);
        if (!user) continue;
        const dataUrl = demoImage(documentLabel);
        const payload = JSON.stringify({
            idType,
            idNumber,
            document: { name: `${documentLabel}.svg`, mime: "image/svg+xml", dataUrl },
            selfie: { name: `${documentLabel}-selfie.svg`, mime: "image/svg+xml", dataUrl },
        });
        insertKyc.run(
            user.id,
            idType,
            `${documentLabel}.svg`,
            "image/svg+xml",
            encryptText(payload),
            `${documentLabel}-selfie.svg`,
            "image/svg+xml",
            encryptText(payload),
            status,
            status === "rejected" ? "Photo quality or ID details could not be verified." : null,
            status === "pending" ? "-3 days" : "-7 days",
            status === "pending" ? null : "-2 days"
        );
    }

    const insertCampaign = db.prepare(`
        INSERT INTO campaigns (title, description, category, goal_amount, raised_amount, status, created_by, reported_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);

    const campaigns = [
        ["Livelihood Kits for PWD Beneficiaries", "Provide starter livelihood kits (sewing machines, tools) to persons with disabilities.", "Livelihood", 250000, 187500, "active", "Kilometro Zero Staff", 0, "-30 days"],
        ["Skills Training Scholarship Fund", "Fund TESDA-accredited skills training slots for underserved youth.", "Education", 150000, 150000, "completed", "Kilometro Zero Staff", 0, "-90 days"],
        ["Community Feeding Program", "Weekly feeding program for children in Barangay 772.", "Relief", 80000, 32000, "active", "Kilometro Zero Staff", 0, "-12 days"],
        ["Disaster Relief - Typhoon Response", "Emergency relief goods for typhoon-affected families.", "Relief", 300000, 300000, "completed", "Kilometro Zero Staff", 0, "-150 days"],
        ["New Livelihood Center Construction", "Build a dedicated livelihood training center in Sta. Ana.", "Infrastructure", 1200000, 45000, "pending", "Maria Santos", 0, "-2 days"],
        ["Solo Parent Micro-Business Grants", "Small grants for solo parents starting home-based businesses.", "Livelihood", 100000, 5000, "pending", "Juan Dela Cruz", 2, "-1 days"],
    ];
    const campaignIds = [];
    for (const c of campaigns) {
        const info = insertCampaign.run(...c);
        campaignIds.push(info.lastInsertRowid);
    }

    const insertDonation = db.prepare(`
        INSERT INTO donations (campaign_id, donor_name, donor_email, is_public, amount, payment_status, payment_method, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);

    const donations = [
        [campaignIds[0], "Maria Santos", "maria.santos@example.com", 1, 5000, "successful", "GCash", "-25 days"],
        [campaignIds[0], "Anonymous", null, 0, 2500, "successful", "Bank Transfer", "-20 days"],
        [campaignIds[0], "Juan Dela Cruz", "juan.delacruz@example.com", 1, 10000, "successful", "GCash", "-18 days"],
        [campaignIds[2], "Krystel Ramos", "krystel.ramos@example.com", 1, 1500, "successful", "GCash", "-8 days"],
        [campaignIds[2], "Nicole Aquino", "nicole.aquino@example.com", 1, 1000, "pending", "Mock Gateway", "-2 days"],
        [campaignIds[1], "Ramon Torres", "ramon.torres@example.com", 1, 20000, "successful", "Bank Transfer", "-80 days"],
        [campaignIds[3], "Anonymous", null, 0, 15000, "successful", "GCash", "-140 days"],
        [campaignIds[0], "Paolo Fernandez", "paolo.fernandez@example.com", 1, 3000, "failed", "Mock Gateway", "-1 days"],
        [campaignIds[4], "Maria Santos", "maria.santos@example.com", 1, 5000, "successful", "GCash", "-1 days"],
    ];
    for (const d of donations) insertDonation.run(...d);

    db.prepare(`
        INSERT INTO withdrawals (campaign_id, amount, status, created_at)
        VALUES (?, ?, ?, datetime('now', ?))
    `).run(campaignIds[1], 140000, "completed", "-60 days");

    const insertNotif = db.prepare(`
        INSERT INTO notifications (type, message, is_read, created_at)
        VALUES (?, ?, ?, datetime('now', ?))
    `);
    insertNotif.run("new_campaign", "New campaign submitted for review: \"New Livelihood Center Construction\"", 0, "-2 days");
    insertNotif.run("new_campaign", "New campaign submitted for review: \"Solo Parent Micro-Business Grants\"", 0, "-1 days");
    insertNotif.run("new_donation", "New donation received: ₱5,000 for \"Livelihood Kits for PWD Beneficiaries\"", 1, "-1 days");
    insertNotif.run("campaign_report", "Campaign \"Solo Parent Micro-Business Grants\" was reported by a user", 0, "-12 hours");

    const insertActivity = db.prepare(`
        INSERT INTO activity_log (action, details, created_at)
        VALUES (?, ?, datetime('now', ?))
    `);
    insertActivity.run("campaign_created", "Maria Santos submitted \"New Livelihood Center Construction\"", "-2 days");
    insertActivity.run("donation_received", "₱5,000 donation to \"New Livelihood Center Construction\"", "-1 days");
    insertActivity.run("campaign_completed", "\"Skills Training Scholarship Fund\" reached its goal", "-10 days");
    insertActivity.run("user_registered", "Ramon Torres created an account", "-5 days");

    console.log("Demo data seeded successfully (users, campaigns, donations, notifications, activity).");
    process.exit(0);
}

seed().catch((err) => {
    console.error("Failed to seed demo data:", err);
    process.exit(1);
});
