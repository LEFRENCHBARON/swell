// What this module owns: host payment profile queries (bank details, payout eligibility).
// Does NOT own: Stripe API calls, booking payments, deposit lifecycle.
const pool = require('./index');
const { encryptIBAN, maskIBAN } = require('../services/iban-encryption');

/**
 * Get payment profile for a host.
 * Returns stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarding_completed_at.
 * IBAN is returned masked (e.g. FR76 •••• •••• •••• 1896) — never plaintext.
 */
async function getHostPaymentProfile(userId) {
  const result = await pool.query(`
    SELECT id, name, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled,
           stripe_onboarding_completed_at, iban_last4, iban_encrypted
    FROM users WHERE id = $1
  `, [userId]);
  const row = result.rows[0];
  if (!row) return null;
  // Build masked IBAN display from iban_last4 if available
  let ibanMasked = null;
  if (row.iban_last4) {
    // Reconstruct display: country + •••• + last4
    // The iban_last4 stores the last 4 chars; we reconstruct the masked form
    ibanMasked = `•••• •••• •••• ${row.iban_last4}`;
  }
  return {
    id: row.id,
    name: row.name,
    stripe_account_id: row.stripe_account_id,
    stripe_charges_enabled: row.stripe_charges_enabled,
    stripe_payouts_enabled: row.stripe_payouts_enabled,
    stripe_onboarding_completed_at: row.stripe_onboarding_completed_at,
    ibanMasked: row.iban_last4 ? `•••• •••• •••• ${row.iban_last4}` : null
  };
}

/**
 * Save host bank details (IBAN + account holder name).
 * IBAN is AES-256-GCM encrypted before storage; plaintext is never stored.
 * Admin must separately enable payouts after verifying the IBAN.
 */
async function saveHostBankDetails(userId, { iban, accountName }) {
  const ibanEnc = encryptIBAN(iban);
  const ibanLast4 = iban.slice(-4);
  const result = await pool.query(`
    UPDATE users
    SET stripe_account_id = CONCAT('bank_', $1),
        iban_encrypted = $2,
        iban_last4 = $3,
        bank_iban = NULL,   -- cleared: IBAN no longer stored in plaintext
        bank_account_name = $4,
        stripe_charges_enabled = TRUE,
        stripe_onboarding_completed_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, stripe_account_id, iban_last4, bank_account_name, stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarding_completed_at
  `, [userId, ibanEnc, ibanLast4, accountName || null]);
  return result.rows[0] || null;
}

/**
 * Admin: enable payouts for a host (after IBAN verification).
 */
async function adminEnableHostPayouts(userId) {
  const result = await pool.query(`
    UPDATE users
    SET stripe_payouts_enabled = TRUE, updated_at = NOW()
    WHERE id = $1
    RETURNING id, stripe_payouts_enabled
  `, [userId]);
  return result.rows[0] || null;
}

/**
 * Check if a board's host has payment set up (used by booking flow).
 * Returns { hostId, chargesEnabled } for a given board.
 */
async function getBoardHostPaymentStatus(boardId) {
  const result = await pool.query(`
    SELECT u.id AS host_id, u.name AS host_name,
           u.stripe_charges_enabled, u.stripe_payouts_enabled
    FROM boards b
    JOIN users u ON u.id = b.host_id
    WHERE b.id = $1
  `, [boardId]);
  return result.rows[0] || null;
}

module.exports = { getHostPaymentProfile, saveHostBankDetails, adminEnableHostPayouts, getBoardHostPaymentStatus };