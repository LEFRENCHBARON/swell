// What this module owns: promo code validation endpoint.
// Does NOT own booking creation or payment — just validates a code and returns discount info.
const express = require('express');
const router = express.Router();
const { validatePromoCode, calcPromoDiscount } = require('../db/promoCodes');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// POST /api/promo/validate
// Body: { code, rentalCents, isHourly }
// Returns: { valid, discountCents, message, code }
router.post('/validate', requireAuth, async (req, res) => {
  const { code, rentalCents, isHourly } = req.body;

  if (!code) return res.status(400).json({ valid: false, message: 'Code manquant' });
  if (!rentalCents || rentalCents <= 0) return res.status(400).json({ valid: false, message: 'Montant de location requis' });

  try {
    const result = await validatePromoCode(code, req.session.userId, !!isHourly);

    if (!result.valid) {
      return res.json({ valid: false, message: result.reason });
    }

    const discountCents = calcPromoDiscount(
      parseInt(rentalCents),
      result.discountPct,
      result.maxDiscountCents
    );

    return res.json({
      valid: true,
      code: result.code,
      discountCents,
      discountPct: result.discountPct,
      maxDiscountCents: result.maxDiscountCents,
      message: `🎁 Code appliqué — ${result.discountPct}% de réduction (−€${(discountCents/100).toFixed(2)})`
    });
  } catch (err) {
    console.error('[Promo] validate error:', err.message);
    res.status(500).json({ valid: false, message: 'Erreur lors de la validation du code' });
  }
});

module.exports = router;
