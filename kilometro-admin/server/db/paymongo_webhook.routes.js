// server/routes/paymongo_webhook.routes.js
//
// IMPORTANT: this router must be mounted in index.js using express.raw(),
// and it must be mounted BEFORE the global app.use(express.json()) line.
// Signature verification needs the exact original bytes PayMongo sent -
// if express.json() parses the body first, verification will always fail.

const express = require("express");
const db = require("../db/database");
const { verifyWebhookSignature } = require("../utils/paymongo");
const { sendDonationReceiptEmail } = require("../utils/mailer");

const router = express.Router();

router.post("/", async (req, res) => {
    const signatureHeader = req.headers["paymongo-signature"];
    const rawBody = req.body; // Buffer, because this route uses express.raw()

    const isValid = verifyWebhookSignature(rawBody, signatureHeader, process.env.PAYMONGO_WEBHOOK_SECRET);
    if (!isValid) {
        console.warn("[paymongo-webhook] rejected request with invalid signature");
        return res.status(401).json({ error: "Invalid signature." });
    }

    let event;
    try {
        event = JSON.parse(rawBody.toString("utf8"));
    } catch (err) {
        console.warn("[paymongo-webhook] failed to parse payload:", err.message);
        return res.status(400).json({ error: "Invalid payload." });
    }

    // Always acknowledge quickly so PayMongo doesn't retry; do the real work
    // after, wrapped so a processing error can't turn into a duplicate retry
    // storm (we log it instead).
    res.sendStatus(200);

    try {
        const eventType = event?.data?.attributes?.type;
        if (eventType !== "checkout_session.payment.paid") {
            return; // We only subscribed to/handle this one event type.
        }

        const checkoutSession = event.data.attributes.data;
        const checkoutSessionId = checkoutSession?.id;
        if (!checkoutSessionId) {
            console.warn("[paymongo-webhook] checkout_session.payment.paid event missing session id");
            return;
        }

        const donation = db.prepare(
            "SELECT * FROM donations WHERE paymongo_checkout_session_id = ?"
        ).get(checkoutSessionId);

        if (!donation) {
            console.warn(`[paymongo-webhook] no donation found for checkout session ${checkoutSessionId}`);
            return;
        }

        // Idempotency: webhooks can be retried/re-delivered, don't double-process.
        if (donation.payment_status === "successful") {
            return;
        }

        const payments = checkoutSession?.attributes?.payments || [];
        const paymentId = payments[0]?.id || null;

        db.transaction(() => {
            db.prepare(`
                UPDATE donations
                SET payment_status = 'successful',
                    paymongo_payment_id = ?
                WHERE id = ?
            `).run(paymentId, donation.id);

            if (donation.campaign_id) {
                db.prepare(
                    "UPDATE campaigns SET raised_amount = raised_amount + ?, updated_at = datetime('now') WHERE id = ?"
                ).run(donation.amount, donation.campaign_id);
            }

            db.prepare("INSERT INTO notifications (type, message, is_read) VALUES ('new_donation', ?, 0)").run(
                `${donation.donor_name} donated ₱${Number(donation.amount).toLocaleString("en-PH", { maximumFractionDigits: 0 })} via PayMongo`
            );
            db.prepare("INSERT INTO activity_log (action, details) VALUES (?, ?)").run(
                "donation_payment_confirmed",
                `PayMongo payment confirmed for donation #${donation.id} (${checkoutSessionId})`
            );
        })();

        if (donation.donor_email) {
            const campaign = donation.campaign_id
                ? db.prepare("SELECT title FROM campaigns WHERE id = ?").get(donation.campaign_id)
                : null;

            try {
                await sendDonationReceiptEmail(
                    donation.donor_email,
                    donation.donor_name,
                    donation.amount,
                    donation.id,
                    campaign ? campaign.title : null
                );
                db.prepare(
                    "UPDATE donations SET receipt_email_sent = 1, receipt_email_sent_at = datetime('now') WHERE id = ?"
                ).run(donation.id);
            } catch (err) {
                console.warn(`[paymongo-webhook] receipt email failed for donation #${donation.id}: ${err.message}`);
                db.prepare("UPDATE donations SET receipt_email_error = ? WHERE id = ?").run(err.message, donation.id);
            }
        }
    } catch (err) {
        console.error("[paymongo-webhook] unexpected error processing event:", err);
    }
});

module.exports = router;
