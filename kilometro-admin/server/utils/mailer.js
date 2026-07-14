const nodemailer = require("nodemailer");

function hasSmtpConfig() {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

function createMailer() {
    if (!hasSmtpConfig()) {
        return null;
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

async function sendVerificationEmail(to, code, name) {
    const transport = createMailer();
    if (!transport) {
        throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM in .env.");
    }

    await transport.sendMail({
        from: process.env.SMTP_FROM,
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

module.exports = {
    hasSmtpConfig,
    sendVerificationEmail,
};