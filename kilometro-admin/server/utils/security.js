const crypto = require("crypto");

const encryptionSecret = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || "kilometro-zero-development-key";
const encryptionKey = crypto.createHash("sha256").update(String(encryptionSecret)).digest();

function encryptText(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, encrypted].map((part) => part.toString("base64")).join(".");
}

function decryptText(payload) {
    if (!payload) return "";
    const [ivText, authTagText, encryptedText] = String(payload).split(".");
    if (!ivText || !authTagText || !encryptedText) {
        throw new Error("Invalid encrypted payload format.");
    }

    const iv = Buffer.from(ivText, "base64");
    const authTag = Buffer.from(authTagText, "base64");
    const encrypted = Buffer.from(encryptedText, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function hashValue(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createVerificationCode() {
    return String(crypto.randomInt(100000, 999999));
}

function secureCookieOptions(maxAgeMs) {
    return {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: maxAgeMs,
        path: "/",
    };
}

module.exports = {
    encryptText,
    decryptText,
    hashValue,
    createVerificationCode,
    secureCookieOptions,
};