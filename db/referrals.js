// What this module owns: referral_redemptions table queries; referral code lookup and credit grants.
// Does NOT own user creation, booking logic, or email sending.
const pool = require('./index');
const crypto = require('crypto');

// Generate a short shareable code: e.g. "LEO-X7K2" (3 chars + dash + 4 chars)
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/1/0 to avoid confusion
  let code = '';
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 3; i++) code += chars[bytes[i] % chars.length];
  code += '-';
  for (let i = 3; i < 7; i++) code += chars[bytes[i] % chars.length];
  return code;
}

// Assign a referral code to a user (on signup or backfill). Retries on collision.
async function assignReferralCode(userId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateReferralCode();
    try {
      const result = await pool.query(
        `UPDATE users SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL RETURNING referral_code`,
        [code, userId]
      );
      if (result.rows.length > 0) return result.rows[0].referral_code;
    } catch (err) {
      if (err.code !== '23505') throw err; // rethrow non-unique-constraint errors
    }
  }
  // Fallback: return existing code if already set
  const existing = await pool.query(`SELECT referral_code FROM users WHERE id = $1`, [userId]);
  return existing.rows[0]?.referral_code || null;
}

// Look up which user owns a given referral code. Returns user { id, name } or null.
async function getUserByReferralCode(code) {
  if (!code) return null;
  const result = await pool.query(
    `SELECT id, name FROM users WHERE UPPER(referral_code) = UPPER($1)`,
    [code.trim()]
  );
  return result.rows[0] || null;
}

// Set referred_by_user_id on a newly registered user (best-effort on signup).
async function setReferredBy(userId, inviterUserId) {
  // Block self-referral
  if (userId === inviterUserId) return;
  await pool.query(
    `UPDATE users SET referred_by_user_id = $1 WHERE id = $2 AND referred_by_user_id IS NULL`,
    [inviterUserId, userId]
  );
}

// Grant referral credits to both inviter and invitee on first paid booking.
// Idempotent: unique (invitee_id) constraint prevents double-grants.
// Returns true if credits were granted, false if already redeemed or inviter cap reached.
async function grantReferralCredits(inviteeUserId, bookingId) {
  // Get inviter
  const userRes = await pool.query(
    `SELECT referred_by_user_id FROM users WHERE id = $1`,
    [inviteeUserId]
  );
  const user = userRes.rows[0];
  if (!user || !user.referred_by_user_id) return false;

  const inviterId = user.referred_by_user_id;

  // Check inviter hasn't hit 5-redemption cap
  const capRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM referral_redemptions WHERE inviter_id = $1`,
    [inviterId]
  );
  if (parseInt(capRes.rows[0].cnt) >= 5) return false;

  // Insert redemption (fails silently on duplicate invitee_id)
  try {
    await pool.query(
      `INSERT INTO referral_redemptions (inviter_id, invitee_id, booking_id, inviter_credit_cents, invitee_credit_cents)
       VALUES ($1, $2, $3, 1000, 1000)`,
      [inviterId, inviteeUserId, bookingId]
    );
  } catch (err) {
    if (err.code === '23505') return false; // already redeemed
    throw err;
  }

  // Credit both parties
  await pool.query(
    `UPDATE users SET referral_credit_cents = referral_credit_cents + 1000 WHERE id = $1 OR id = $2`,
    [inviterId, inviteeUserId]
  );

  return true;
}

// Check if a user has already had their referral redeemed (first booking completed)
async function hasReferralBeenRedeemed(inviteeUserId) {
  const res = await pool.query(
    `SELECT id FROM referral_redemptions WHERE invitee_id = $1 LIMIT 1`,
    [inviteeUserId]
  );
  return res.rows.length > 0;
}

// Get referral stats for a user (for the invite card in app.html)
async function getReferralStats(userId) {
  const userRes = await pool.query(
    `SELECT referral_code, referral_credit_cents, referred_by_user_id FROM users WHERE id = $1`,
    [userId]
  );
  const user = userRes.rows[0];
  if (!user) return null;

  const redemptionsRes = await pool.query(
    `SELECT COUNT(*) AS total_redemptions FROM referral_redemptions WHERE inviter_id = $1`,
    [userId]
  );

  return {
    referralCode: user.referral_code,
    creditCents: user.referral_credit_cents,
    totalRedemptions: parseInt(redemptionsRes.rows[0].total_redemptions),
    remainingSlots: Math.max(0, 5 - parseInt(redemptionsRes.rows[0].total_redemptions))
  };
}

// Admin: get all users with their referral code (for email campaign backfill)
async function getAllUsersWithReferralCodes() {
  const res = await pool.query(
    `SELECT id, name, email, referral_code FROM users
     WHERE email IS NOT NULL AND email != '' AND id != 9
     ORDER BY created_at ASC`
  );
  return res.rows;
}

module.exports = {
  generateReferralCode,
  assignReferralCode,
  getUserByReferralCode,
  setReferredBy,
  grantReferralCredits,
  hasReferralBeenRedeemed,
  getReferralStats,
  getAllUsersWithReferralCodes
};
