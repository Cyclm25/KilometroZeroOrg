// server/routes/dashboard.routes.js
const express = require("express");
const db = require("../db/database");
const router = express.Router();

router.get("/overview", async (req, res) => {
    const totalCampaigns = (await db.prepare("SELECT COUNT(*) c FROM campaigns").get()).c;
    const activeCampaigns = (await db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status = 'active'").get()).c;
    const completedCampaigns = (await db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status = 'completed'").get()).c;
    const pendingCampaigns = (await db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status = 'pending'").get()).c;
    const totalUsers = (await db.prepare("SELECT COUNT(*) c FROM users WHERE role != 'admin'").get()).c;
    const totalDonors = (await db.prepare("SELECT COUNT(*) c FROM users WHERE is_donor = 1").get()).c;
    const verifiedDonors = (await db.prepare("SELECT COUNT(*) c FROM users WHERE email_verified = 1 AND role != 'admin'").get()).c;
    const approvedKyc = (await db.prepare("SELECT COUNT(*) c FROM users WHERE kyc_status = 'approved' AND role != 'admin'").get()).c;
    const pendingKyc = (await db.prepare("SELECT COUNT(*) c FROM users WHERE kyc_status = 'pending' AND role != 'admin'").get()).c;
    const rejectedKyc = (await db.prepare("SELECT COUNT(*) c FROM users WHERE kyc_status = 'rejected' AND role != 'admin'").get()).c;

    const totalDonated = (await db.prepare(
        "SELECT COALESCE(SUM(amount),0) s FROM donations WHERE payment_status = 'successful'"
    ).get()).s;
    const successfulPayments = (await db.prepare("SELECT COUNT(*) c FROM donations WHERE payment_status = 'successful'").get()).c;
    const pendingPayments = (await db.prepare("SELECT COUNT(*) c FROM donations WHERE payment_status = 'pending'").get()).c;
    const failedPayments = (await db.prepare("SELECT COUNT(*) c FROM donations WHERE payment_status = 'failed'").get()).c;
    const withdrawnFunds = (await db.prepare(
        "SELECT COALESCE(SUM(amount),0) s FROM withdrawals WHERE status = 'completed'"
    ).get()).s;

    const recentActivity = await db.prepare(
        "SELECT action, details, created_at FROM activity_log ORDER BY created_at DESC LIMIT 10"
    ).all();

    // Last 6 months donation totals for the trend chart
    const monthlyTrendRows = await db.prepare(`
        SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(amount),0) AS total
        FROM donations
        WHERE payment_status = 'successful'
        GROUP BY month
        ORDER BY month DESC
        LIMIT 6
    `).all();
    const monthlyTrend = monthlyTrendRows.reverse();

    res.json({
        campaigns: {
            total: totalCampaigns,
            active: activeCampaigns,
            completed: completedCampaigns,
            pending: pendingCampaigns,
        },
        users: {
            totalUsers,
            totalDonors,
            verifiedDonors,
            approvedKyc,
            pendingKyc,
            rejectedKyc,
        },
        payments: {
            totalDonated,
            successfulPayments,
            pendingPayments,
            failedPayments,
            withdrawnFunds,
            isMockData: false, // real PayMongo payments now, no longer mock data
        },
        recentActivity,
        monthlyTrend,
    });
});

module.exports = router;