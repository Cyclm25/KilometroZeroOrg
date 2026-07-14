// server/routes/dashboard.routes.js
const express = require("express");
const db = require("../db/database");
const router = express.Router();

router.get("/overview", (req, res) => {
    const totalCampaigns = db.prepare("SELECT COUNT(*) c FROM campaigns").get().c;
    const activeCampaigns = db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status = 'active'").get().c;
    const completedCampaigns = db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status = 'completed'").get().c;
    const pendingCampaigns = db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status = 'pending'").get().c;
    const totalUsers = db.prepare("SELECT COUNT(*) c FROM users WHERE role != 'admin'").get().c;
    const totalDonors = db.prepare("SELECT COUNT(*) c FROM users WHERE is_donor = 1").get().c;

    const totalDonated = db.prepare(
        "SELECT COALESCE(SUM(amount),0) s FROM donations WHERE payment_status = 'successful'"
    ).get().s;
    const successfulPayments = db.prepare("SELECT COUNT(*) c FROM donations WHERE payment_status = 'successful'").get().c;
    const pendingPayments = db.prepare("SELECT COUNT(*) c FROM donations WHERE payment_status = 'pending'").get().c;
    const failedPayments = db.prepare("SELECT COUNT(*) c FROM donations WHERE payment_status = 'failed'").get().c;
    const withdrawnFunds = db.prepare(
        "SELECT COALESCE(SUM(amount),0) s FROM withdrawals WHERE status = 'completed'"
    ).get().s;

    const recentActivity = db.prepare(
        "SELECT action, details, created_at FROM activity_log ORDER BY created_at DESC LIMIT 10"
    ).all();

    // Last 6 months donation totals for the trend chart (mock-gateway aware)
    const monthlyTrend = db.prepare(`
        SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(amount),0) AS total
        FROM donations
        WHERE payment_status = 'successful'
        GROUP BY month
        ORDER BY month DESC
        LIMIT 6
    `).all().reverse();

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
        },
        payments: {
            // NOTE: real payment gateway is still under development.
            // These figures come from mock/demo donation records until then.
            totalDonated,
            successfulPayments,
            pendingPayments,
            failedPayments,
            withdrawnFunds,
            isMockData: true,
        },
        recentActivity,
        monthlyTrend,
    });
});

module.exports = router;
