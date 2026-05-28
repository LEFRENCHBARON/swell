// Consent log DB queries. Owned: consent logging for CNIL proof.
// Does NOT own: cookie handling, frontend consent UI, pixel activation.
const pool = require('./index');
const crypto = require('crypto');

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

/**
 * Log a consent event. All RGPD-required fields captured.
 * @param {object} params
 * @param {number|null} params.userId       - null for anonymous visitors
 * @param {string|null} params.sessionId   - connect.sid value (from req.cookies.swell_sid)
 * @param {string|null} params.anonId      - swell_ref cookie for anonymous reconciliation
 * @param {string|null} params.bannerVersion - banner version tag for audit
 * @param {string}      params.consent     - JSON string of consent object
 * @param {string}      params.ip          - raw IP (hashed before storage)
 * @param {string}      params.userAgent
 */
async function logConsent({ userId, sessionId, anonId, bannerVersion, consent, ip, userAgent }) {
  const ipHash = hashIp(ip || '0.0.0.0');
  await pool.query(
    `INSERT INTO consent_log (user_id, session_id, anon_id, banner_version, consent, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId || null, sessionId || null, anonId || null, bannerVersion || 'v1', consent, ipHash, userAgent || '']
  );
}

module.exports = { logConsent };