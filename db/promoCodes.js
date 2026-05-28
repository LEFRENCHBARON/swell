// What this module owns: promo_codes table queries and promo_redemptions log.
// Does NOT own booking creation, payment processing, or HTTP responses.
const pool = require('./index');

// Validate a promo code for a given user and booking context.
// Returns { valid: true, code, discountPct, maxDiscountCents, ... } or { valid: false, reason }.
async function validatePromoCode(code, userId, isHourly) {
  if (!code) return { valid: false, reason: 'Code vide' };

  const codeUpper = code.trim().toUpperCase();

  const result = await pool.query(
    `SELECT * FROM promo_codes WHERE code = $1 AND active = TRUE`,
    [codeUpper]
  );

  if (result.rows.length === 0) {
    return { valid: false, reason: 'Code promo invalide' };
  }

  const promo = result.rows[0];

  // Validity window check
  if (promo.valid_until && new Date(promo.valid_until) < new Date()) {
    return { valid: false, reason: 'Code promo expiré' };
  }

  // Hourly-only gate
  if (promo.hourly_only && !isHourly) {
    return { valid: false, reason: 'Ce code s\'applique uniquement aux réservations à l\'heure' };
  }

  // Single-use per user check
  if (promo.single_use_per_user) {
    const used = await pool.query(
      `SELECT id FROM promo_redemptions WHERE user_id = $1 AND code = $2 LIMIT 1`,
      [userId, codeUpper]
    );
    if (used.rows.length > 0) {
      return { valid: false, reason: 'Tu as déjà utilisé ce code promo' };
    }
  }

  // First booking only — check if user has any prior confirmed/paid booking
  if (promo.first_booking_only) {
    const prior = await pool.query(
      `SELECT id FROM bookings WHERE renter_id = $1 AND payment_status = 'paid' LIMIT 1`,
      [userId]
    );
    if (prior.rows.length > 0) {
      return { valid: false, reason: 'Ce code est réservé à ta première réservation' };
    }
  }

  return {
    valid: true,
    code: codeUpper,
    discountPct: parseFloat(promo.discount_pct),
    maxDiscountCents: promo.max_discount_cents,
    firstBookingOnly: promo.first_booking_only,
    hourlyOnly: promo.hourly_only
  };
}

// Calculate discount amount in cents given rental subtotal and promo rules.
// Discount applies to rental subtotal only — host net is unchanged; platform eats the cost.
function calcPromoDiscount(rentalCents, discountPct, maxDiscountCents) {
  const raw = Math.round(rentalCents * discountPct / 100);
  return maxDiscountCents > 0 ? Math.min(raw, maxDiscountCents) : raw;
}

// Record a promo redemption after successful booking creation.
// Idempotent — if the unique constraint fires (concurrent double-use), we silently skip.
async function recordPromoRedemption(userId, bookingId, code, discountCents) {
  await pool.query(
    `INSERT INTO promo_redemptions (user_id, booking_id, code, discount_cents)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, code) DO NOTHING`,
    [userId, bookingId, code.toUpperCase(), discountCents]
  );
}

module.exports = { validatePromoCode, calcPromoDiscount, recordPromoRedemption };
