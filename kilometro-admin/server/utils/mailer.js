// Uses Resend's HTTPS API (https://resend.com) instead of raw SMTP.
// Render's free tier blocks outbound traffic on SMTP ports 25/465/587,
// but HTTPS (port 443) is never blocked, so this sidesteps that entirely.
//
// Required env vars:
//   RESEND_API_KEY - from https://resend.com/api-keys
//   RESEND_FROM     - a verified sender, e.g. "Kilometro Zero <onboarding@resend.dev>"
//                      (Resend gives you a free @resend.dev sending address
//                      for testing with no domain setup needed; for a custom
//                      domain you verify it once in the Resend dashboard)

const RESEND_API_URL = "https://api.resend.com/emails";

function hasSmtpConfig() {
    // Kept the same function name so donor_routes.js / index.js don't need
    // to change; it now just checks Resend config instead of SMTP config.
    return !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

async function sendViaResend({ to, subject, text, html }) {
    if (!hasSmtpConfig()) {
        throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM in .env.");
    }

    const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM,
            to,
            subject,
            text,
            html,
        }),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(`Resend API error (${response.status}): ${errBody || response.statusText}`);
    }

    return response.json();
}

async function sendVerificationEmail(to, code, name) {
    await sendViaResend({
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

    await sendViaResend({
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