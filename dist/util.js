import crypto from 'node:crypto';
import { env } from './env.js';
export function uuid() {
    return crypto.randomUUID();
}
export function nowIso() {
    return new Date().toISOString();
}
export function isHex64(s) {
    return /^[a-f0-9]{64}$/i.test(s);
}
/** Mask email in logs: p***@domain.com (never log full PII). */
export function maskEmail(email) {
    if (!email || typeof email !== 'string')
        return '***';
    const at = email.indexOf('@');
    if (at <= 0)
        return '***';
    const local = email.slice(0, at);
    const domain = email.slice(at);
    const masked = local.length <= 2 ? '***' : local.slice(0, 1) + '***';
    return masked + domain;
}
/** SHA-256 hash of token for storage (connector_tokens.token_hash). */
export function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
/** Generate a secure random token (32 bytes = 64 hex chars). */
export function generateConnectorToken() {
    return crypto.randomBytes(32).toString('hex');
}
// --- Customer API secrets (zero-knowledge: never store plain; encrypt for outbound calls) ---
/** Generate a secure API secret (32 bytes hex). Shown once on create/rotate. */
export function generateApiSecret() {
    return crypto.randomBytes(32).toString('hex');
}
/** SHA-256 hash of secret (for verification only; we use encryptSecret for reversible storage). */
export function hashSecret(secret) {
    return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}
/** Mask secret for logs/responses: first 4 and last 4 chars. */
export function maskSecret(secret) {
    if (secret.length <= 12)
        return '***';
    return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
function getEncryptionKey() {
    const key = env.APP_ENCRYPTION_KEY;
    if (!key || key.length < 32) {
        throw new Error('APP_ENCRYPTION_KEY must be set and at least 32 characters for HMAC/BEARER integrations');
    }
    return crypto.createHash('sha256').update(key.slice(0, 64), 'utf8').digest();
}
/** Encrypt a secret for storage. Requires APP_ENCRYPTION_KEY. */
export function encryptSecret(plain) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}
/** Decrypt a stored secret. */
export function decryptSecret(encrypted) {
    const key = getEncryptionKey();
    const buf = Buffer.from(encrypted, 'base64');
    if (buf.length < IV_LEN + TAG_LEN)
        throw new Error('Invalid encrypted payload');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
}
/** HMAC-SHA256 signature for body + timestamp (X-DAP-Timestamp + body). */
export function signHmac(secret, timestamp, body) {
    return crypto.createHmac('sha256', secret).update(timestamp + body).digest('hex');
}
