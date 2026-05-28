// What this module owns: host payment profile — bank detail submission, payment status, admin enablement.
// Does NOT own: Stripe API, booking payments, deposit lifecycle, identity verification.
const express = require('express');
const router = express.Router();
const { getHostPaymentProfile, saveHostBankDetails, adminEnableHostPayouts, getBoardHostPaymentStatus } = require('../db/stripe-connect');

const ADMIN_SECRET = process.env.ADMIN_SECRET;

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connexion requise' });
  next();
}

// Validate IBAN format (ISO 13616 structure) + mod-97 checksum.
// Returns { valid, error } — error is a French message for the user.
function validateIBAN(iban) {
  const cleaned = iban.replace(/\n/g, '').replace(/\n/g, '').replace(/\n/g, '').replace(/[ ]/g, '').toUpperCase();

  // Country-specific IBAN lengths (common European countries)
  const ibanLengths = {
    AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
    EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28,
    IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27,
    MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19,
    SK: 24, SM: 27, TN: 24, TR: 26
  };

  const country = cleaned.slice(0, 2);
  const expectedLen = ibanLengths[country];
  if (!expectedLen) {
    return { valid: false, error: 'Code pays IBAN non reconnu — vérifie les 2 premières lettres' };
  }
  if (cleaned.length !== expectedLen) {
    return { valid: false, error: `IBAN incomplet — attendu ${expectedLen} caractères pour ${country}, reçu ${cleaned.length}` };
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(cleaned)) {
    return { valid: false, error: 'Format IBAN invalide — caractères non autorisés détectés' };
  }

  // mod-97 checksum: move first 4 chars to end, convert letters to digits (A=10, B=11, ...),
  // then check that the integer mod 97 === 1
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let numeric = '';
  for (const c of rearranged) {
    if (c >= '0' && c <= '9') {
      numeric += c;
    } else {
      numeric += (c.charCodeAt(0) - 55).toString(); // A=10, B=11, ...
    }
  }
  if (BigInt(numeric) % 97n !== 1n) {
    return { valid: false, error: 'IBAN invalide — vérifie les chiffres et réessaie' };
  }

  return { valid: true, error: null };
}

// GET /api/stripe-connect/status — host's own payment profile
router.get('/status', requireAuth, async (req, res) => {
  try {
    const profile = await getHostPaymentProfile(req.session.userId);
    if (!profile) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({
      chargesEnabled: profile.stripe_charges_enabled,
      payoutsEnabled: profile.stripe_payouts_enabled,
      onboardingCompleted: !!profile.stripe_onboarding_completed_at,
      completedAt: profile.stripe_onboarding_completed_at || null,
      ibanMasked: profile.ibanMasked || null
    });
  } catch (err) {
    console.error('[StripeConnect] status error:', err.message);
    res.status(500).json({ error: 'Impossible de charger le statut paiement' });
  }
});

// POST /api/stripe-connect/onboard — host submits bank details
// Body: { iban: string, accountName: string }
router.post('/onboard', requireAuth, async (req, res) => {
  const { iban, accountName } = req.body;

  if (!iban || !accountName) {
    return res.status(400).json({ error: 'IBAN et nom du titulaire requis' });
  }

  const cleaned = iban.replace(/\n/g, '').replace(/\n/g, '').replace(/\n/g, '').replace(/[ ]/g, '').toUpperCase();
  const validation = validateIBAN(cleaned);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  if (!accountName.trim() || accountName.trim().length < 2) {
    return res.status(400).json({ error: 'Nom du titulaire invalide' });
  }

  try {
    const result = await saveHostBankDetails(req.session.userId, {
      iban: cleaned,
      accountName: accountName.trim()
    });

    res.json({
      success: true,
      chargesEnabled: result.stripe_charges_enabled,
      completedAt: result.stripe_onboarding_completed_at,
      message: 'Coordonnées bancaires enregistrées. Les virements seront activés sous 24-48h.'
    });
  } catch (err) {
    console.error('[StripeConnect] onboard error:', err.message);
    res.status(500).json({ error: "Impossible d'enregistrer les coordonnées bancaires" });
  }
});

// GET /api/stripe-connect/board/:boardId — check if a board's host accepts payments
// Used by the booking flow to gate the "Réserver" button
router.get('/board/:boardId', async (req, res) => {
  const boardId = parseInt(req.params.boardId);
  if (!boardId) return res.status(400).json({ error: 'boardId invalide' });

  try {
    const status = await getBoardHostPaymentStatus(boardId);
    if (!status) return res.status(404).json({ error: 'Planche introuvable' });

    res.json({
      hostId: status.host_id,
      hostName: status.host_name,
      chargesEnabled: status.stripe_charges_enabled,
      payoutsEnabled: status.stripe_payouts_enabled,
      // Renter can book if host has charges enabled (bank details submitted)
      canBook: status.stripe_charges_enabled
    });
  } catch (err) {
    console.error('[StripeConnect] board status error:', err.message);
    res.status(500).json({ error: 'Impossible de vérifier le statut paiement du host' });
  }
});

// POST /api/stripe-connect/admin/enable-payouts/:userId — admin enables payouts after IBAN verification
// Secured by ADMIN_SECRET header
router.post('/admin/enable-payouts/:userId', async (req, res) => {
  if (!ADMIN_SECRET) return res.status(403).json({ error: 'Admin non configuré' });
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Secret invalide' });
  }

  const userId = parseInt(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'userId invalide' });

  try {
    const result = await adminEnableHostPayouts(userId);
    if (!result) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ success: true, userId, payoutsEnabled: result.stripe_payouts_enabled });
  } catch (err) {
    console.error('[StripeConnect] admin enable payouts error:', err.message);
    res.status(500).json({ error: "Impossible d'activer les virements" });
  }
});

module.exports = router;