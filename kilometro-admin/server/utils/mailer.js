// Uses Brevo's HTTPS Transactional Email API (https://www.brevo.com) instead
// of SMTP. Render's free tier blocks outbound SMTP ports 25/465/587 (this
// includes Brevo's own SMTP relay), but HTTPS (port 443) is never blocked,
// so this sidesteps that entirely - same reasoning as the earlier Resend
// version.
//
// Brevo was chosen over Resend here because it supports verifying a single
// SENDER EMAIL ADDRESS (via a 6-digit code sent to your inbox) rather than
// requiring a verified DOMAIN. That means you can send to ANY recipient
// without owning/buying a domain first.
//
// Setup:
//   1. Sign up free at https://www.brevo.com
//   2. Settings -> Senders, Domains, IPs -> Senders -> add your email
//      (e.g. your Gmail address) -> verify with the 6-digit code Brevo emails you
//   3. Settings -> SMTP & API -> API Keys -> generate a new API key
//
// Required env vars:
//   BREVO_API_KEY     - the API key from step 3 above
//   BREVO_SENDER_EMAIL - the verified sender email from step 2 above
//   BREVO_SENDER_NAME  - (optional) display name, defaults to "Kilometro Zero"

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

function hasSmtpConfig() {
    // Kept the same function name so donor_routes.js / index.js don't need
    // to change; it now just checks Brevo config instead of raw SMTP config.
    return !!(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
}

async function sendViaBrevo({ to, subject, text, html }) {
    if (!hasSmtpConfig()) {
        throw new Error("Brevo is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL in .env.");
    }

    const response = await fetch(BREVO_API_URL, {
        method: "POST",
        headers: {
            "api-key": process.env.BREVO_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            sender: {
                name: process.env.BREVO_SENDER_NAME || "Kilometro Zero",
                email: process.env.BREVO_SENDER_EMAIL,
            },
            to: [{ email: to }],
            subject,
            textContent: text,
            htmlContent: html,
        }),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(`Brevo API error (${response.status}): ${errBody || response.statusText}`);
    }

    return response.json();
}

async function sendVerificationEmail(to, code, name) {
    await sendViaBrevo({
        to,
        subject: "Kilometro Zero email verification code",
        text: `Hello ${name || "donor"},\n\nYour Kilometro Zero verification code is: ${code}\n\nThis code expires in 15 minutes. If you did not request it, you can ignore this message.`,
        html: `
            <div style="font-family:Inter,Arial,sans-serif; line-height:1.6; color:#222;">
                <h2 style="margin:0 0 12px; color:#a00021;">Kilometro Zero Verification</h2>
                <p>Hello ${name || "donor"},</p>
                <p>Your verification code is:</p>
                <p style="font-size:28px; font-weight:700; letter-spacing:4px; color:#171717;">${code}</p>
                <p>This code expires in 15 minutes.</p>
                <p>If you did not request this, you can ignore this email.</p>
            </div>
        `,
    });
}

async function sendDonationReceiptEmail(to, name, amount, donationId, campaignTitle) {
    const formattedAmount = Number(amount || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
    const campaignLabel = campaignTitle || "General Donation";

    await sendViaBrevo({
        to,
        subject: `Kilometro Zero receipt #${donationId}`,
        text: `Hello ${name || "donor"},\n\nThank you for your donation to Kilometro Zero.\n\nDonation ID: ${donationId}\nAmount: ₱${formattedAmount}\nCampaign: ${campaignLabel}\n\nWe appreciate your support.`,
        html: `
            <div style="font-family:Inter,Arial,sans-serif; line-height:1.6; color:#222;">
                <h2 style="margin:0 0 12px; color:#a00021;">Donation receipt #${donationId}</h2>
                <p>Hello ${name || "donor"},</p>
                <p>Your donation has been recorded successfully.</p>
                <ul style="padding-left:18px;">
                    <li><strong>Donation ID:</strong> ${donationId}</li>
                    <li><strong>Amount:</strong> ₱${formattedAmount}</li>
                    <li><strong>Campaign:</strong> ${campaignLabel}</li>
                </ul>
                <p>We appreciate your support of Kilometro Zero.</p>
            </div>
        `,
    });
}

module.exports = {
    hasSmtpConfig,
    sendVerificationEmail,
    sendDonationReceiptEmail,
};