// What this module owns: IBAN encryption and decryption using AES-256-GCM.
// Does NOT own: database operations, key management, IBAN validation.
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 16;
const AUTH_TAG_BYTES = 16;

// Derive a 32-byte key from IBAN_ENCRYPTION_KEY via SHA-256.
// server.js refuses to start if IBAN_ENCRYPTION_KEY is absent, so this is safe.
function deriveKey() {
  return crypto.createHash('sha256').update(process.env.IBAN_ENCRYPTION_KEY).digest();
}

// Encrypt an IBAN string. Returns base64-encoded string containing IV + ciphertext + auth tag.
// Decrypt with decryptIBAN(encrypted).
function encryptIBAN(plaintext) {
  if (!plaintext) return null;
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + ciphertext + authTag)
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

// Decrypt an IBAN. Returns plaintext or null.
function decryptIBAN(encrypted) {
  if (!encrypted) return null;
  try {
    const key = deriveKey();
    const data = Buffer.from(encrypted, 'base64');
    const iv = data.subarray(0, IV_BYTES);
    const authTag = data.subarray(data.length - AUTH_TAG_BYTES, data.length);
    const ciphertext = data.subarray(IV_BYTES, data.length - AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[IBANEncryption] decrypt failed:', err.message);
    return null;
  }
}

// Format an IBAN for display: show only last 4 characters, rest masked.
// Input: 'FR76300060001112345678901896' → 'FR76 •••• •••• •••• •••• 1896'
function maskIBAN(iban) {
  if (!iban) return null;
  const last4 = iban.slice(-4);
  return `${iban.slice(0, 4)} •••• •••• •••• ${last4}`;
}

module.exports = { encryptIBAN, decryptIBAN, maskIBAN };