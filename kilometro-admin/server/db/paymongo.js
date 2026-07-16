// server/utils/paymongo.js
// Thin wrapper around PayMongo's Checkout Session API.
// Docs: https://developers.paymongo.com/docs/checkout-api
//
// Required env vars:
//   PAYMONGO_SECRET_KEY     - sk_test_... (or sk_live_... in production)
//   PAYMONGO_WEBHOOK_SECRET - shown once when you create the webhook endpoint
//                             in the PayMongo dashboard (Developers > Webhooks)
//   PUBLIC_SITE_URL         - e.g. https://kilometrozeroorg.onrender.com
//                             (no trailing slash) - used to build success/cancel URLs

const crypto = require("crypto");

const CHECKOUT_SESSIONS_URL = "https://api.paymongo.com/v1/checkout_sessions";

// Common, widely-available payment method types. If you enable more channels
// in your PayMongo dashboard (Settings > Payment Methods), you can add their
// type strings here - e.g. "qrph", "billease", "dob". Note PayMongo may
// reject certain combinations as "unsupported" together; if you see that
// error, remove the newest addition and re-test.
const DEFAULT_PAYMENT_METHOD_TYPES = ["card", "gcash", "paymaya", "grab_pay"];

function hasPaymongoConfig() {
    return !!(process.env.PAYMONGO_SECRET_KEY && process.env.PUBLIC_SITE_URL);
}

function authHeader() {
    const encoded = Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64");
    return `Basic ${encoded}`;
}

/**
 * Creates a PayMongo Checkout Session for a single donation.
 * Returns { id, checkoutUrl } - id is the cs_... session id to store
 * against the donation row so the webhook can match it back up later.
 */
async function createDonationCheckoutSession({ donationId, amount, donorName, donorEmail, campaignTitle }) {
    if (!hasPaymongoConfig()) {
        throw new Error("PayMongo is not configured. Set PAYMONGO_SECRET_KEY and PUBLIC_SITE_URL in .env.");
    }

    const description = campaignTitle ? `Donation to ${campaignTitle}` : "Donation to Kilometro Zero";
    const successUrl = `${process.env.PUBLIC_SITE_URL}/donate.html?donation=${donationId}&status=success`;
    const cancelUrl = `${process.env.PUBLIC_SITE_URL}/donate.html?donation=${donationId}&status=cancelled`;

    const response = await fetch(CHECKOUT_SESSIONS_URL, {
        method: "POST",
        headers: {
            "Authorization": authHeader(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            data: {
                attributes: {
                    billing: { name: donorName, email: donorEmail },
                    send_email_receipt: false,
                    show_description: true,
                    show_line_items: true,
                    description,
                    line_items: [
                        {
                            currency: "PHP",
                            amount: Math.round(Number(amount) * 100), // PayMongo uses centavos
                            description,
                            name: "Donation",
                            quantity: 1,
                        },
                    ],
                    payment_method_types: DEFAULT_PAYMENT_METHOD_TYPES,
                    success_url: successUrl,
                    cancel_url: cancelUrl,
                },
            },
        }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = body?.errors?.[0]?.detail || response.statusText;
        throw new Error(`PayMongo API error (${response.status}): ${message}`);
    }

    return {
        id: body.data.id,
        checkoutUrl: body.data.attributes.checkout_url,
    };
}

/**
 * Verifies the Paymongo-Signature header against the raw request body.
 * rawBody MUST be the exact, unparsed bytes PayMongo sent (a Buffer or
 * string) - do not run this on a body that has already gone through
 * express.json(), the bytes will no longer match.
 */
function verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
    if (!signatureHeader || !webhookSecret) return false;

    const parts = Object.fromEntries(
        signatureHeader.split(",").map((pair) => {
            const [key, value] = pair.split("=");
            return [key, value];
        })
    );

    const { t, te, li } = parts;
    if (!t) return false;

    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
    const expected = crypto.createHmac("sha256", webhookSecret).update(`${t}.${bodyString}`).digest("hex");

    const matches = (candidate) => {
        if (!candidate) return false;
        const expectedBuf = Buffer.from(expected, "hex");
        const candidateBuf = Buffer.from(candidate, "hex");
        if (expectedBuf.length !== candidateBuf.length) return false;
        return crypto.timingSafeEqual(expectedBuf, candidateBuf);
    };

    // Test mode requests populate `te`, live mode requests populate `li`.
    return matches(te) || matches(li);
}

module.exports = {
    hasPaymongoConfig,
    createDonationCheckoutSession,
    verifyWebhookSignature,
};
