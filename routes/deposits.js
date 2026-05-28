// What this module owns: deposit (caution) lifecycle — hold creation, release, capture, cron.
// Does NOT own: main booking payment, board management, user auth.
// Deposit = a Stripe PaymentIntent with capture_method='manual' (pre-auth hold, no real debit).
// Authorization is triggered INSIDE the booking flow before confirmation (not optional post-step).
// At J+2 after checkout without incident: cancel the PaymentIntent (releases the hold).
// On dispute: capture partial or full amount via admin UI.

const express = require('express');
const router = express.Router();
const { getBookingById, releaseBookingDeposit, captureBookingDeposit } = require('../db/bookings');
const { getBoardEstimatedValue } = require('../db/boards');
const { sendTransactionalEmail } = require('../services/email');

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || 'https://swell.polsia.app';
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;
const CRON_SECRET = process.env.CRON_SECRET;

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// Deposit = 50% of estimated board value, min 50€, max 500€. Zero if no value declared.
function calcDepositCents(estimatedValueCents) {
  if (!estimatedValueCents || estimatedValueCents <= 0) return 0;
  const half = Math.round(estimatedValueCents * 0.5);
  return Math.min(Math.max(half, 5000), 50000);
}

// Create deposit PaymentIntent for a booking.
// Called from /api/bookings POST after rental payment succeeds.
// Returns the PI client_secret so the frontend can complete the pre-auth client-side,
// OR returns immediately if deposit is 0.
router.post('/:bookingId/create', requireAuth, async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  const booking = await getBookingById(bookingId).catch(() => null);

  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
  if (booking.renter_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });
  if (booking.deposit_payment_intent_id) {
    return res.status(400).json({ error: 'Caution déjà créée' });
  }

  const estimatedValueCents = await getBoardEstimatedValue(booking.board_id);
  const depositCents = calcDepositCents(estimatedValueCents);

  if (depositCents === 0) {
    return res.json({ depositRequired: false, depositCents: 0 });
  }

  try {
    const bookingRef = `deposit-${bookingId}-${booking.board_id}`;

    // Create PaymentIntent with capture_method='manual' — funds are held, not captured.
    let piId, clientSecret;
    try {
      const pi = await stripe.paymentIntents.create({
        amount: depositCents,
        currency: 'eur',
        capture_method: 'manual',
        metadata: {
          booking_id: String(bookingId),
          type: 'deposit_hold',
          reference: bookingRef
        },
        description: "Caution Swell — n'est pas débitée. Libérée 48h après la session si aucun dommage n'est signalé.",
      });
      piId = pi.id;
      clientSecret = pi.client_secret;
    } catch (stripeErr) {
      console.error('[Deposits] Stripe PaymentIntent error:', stripeErr.message);
      return res.status(502).json({ error: 'Impossible de créer l’empreinte de caution' });
    }

        if (!piId) return res.status(502).json({ error: 'ID PaymentIntent manquant' });

    // Update booking with PI ID (status stays 'pending_hold' until confirmed client-side)
    await require('../db/bookings').updateBookingDeposit(bookingId, {
      depositAmountCents: depositCents,
      depositSessionId: piId,
      depositStatus: 'pending_hold',
      depositRefundAt: null
    });

    res.json({
      depositRequired: true,
      depositCents,
      paymentIntentId: piId,
      clientSecret
    });
  } catch (err) {
    console.error('[Deposits] Create error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la création de la caution' });
  }
});

// POST /api/deposits/:bookingId/confirm — renter confirms the pre-auth succeeded.
// On confirmation the booking status is updated and host is notified.
router.post('/:bookingId/confirm', requireAuth, async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  const { paymentIntentId } = req.body;

  const booking = await getBookingById(bookingId).catch(() => null);
  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
  if (booking.renter_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });

  if (!booking.deposit_payment_intent_id) {
    return res.status(400).json({ error: 'Aucune caution associée à cette réservation' });
  }

  // Verify the PI exists and is in requires_capture (authorized) state
  try {
    let piState;
    try {
      const piStatus = await stripe.paymentIntents.retrieve(paymentIntentId || booking.deposit_payment_intent_id);
      piState = piStatus.status;
    } catch (err) {
      return res.status(402).json({ error: 'Impossible de vérifier le statut de la caution' });
    }

    if (piState !== 'requires_capture' && piState !== 'authorized') {
      return res.status(402).json({
        error: 'Statut PaymentIntent inattendu — la caution n\u2019a pas été autorisée. Contactez votre banque.',
        status: piState
      });
    }

    // Release window = 48h after the booking end_date
    const endDate = new Date(booking.end_date);
    const releaseAt = new Date(endDate.getTime() + 48 * 60 * 60 * 1000);
    const depositAmt = booking.deposit_amount_cents || 0;

    await require('../db/bookings').updateBookingDeposit(bookingId, {
      depositAmountCents: depositAmt,
      depositSessionId: booking.deposit_payment_intent_id,
      depositStatus: 'held',
      depositRefundAt: releaseAt.toISOString()
    });

    // Email renter: caution en place
    if (depositAmt > 0) {
      sendTransactionalEmail({
        to: booking.renter_email,
        subject: `🔒 Caution bloquée — ${(depositAmt / 100).toFixed(0)}€ sur ta carte`,
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
  <div style="background:#0066aa;color:white;padding:1.5rem;border-radius:8px 8px 0 0;">
    <div style="font-size:1.5rem;margin-bottom:0.3rem;">🔒</div>
    <div style="font-size:1.25rem;font-weight:700;">Empreinte bancaire bloquée</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:1.5rem;background:#fff;">
    <p style="margin:0 0 1rem;">Bonjour ${booking.renter_name},</p>
    <p style="margin:0 0 1rem;">Une empreinte bancaire de <strong>${(depositAmt / 100).toFixed(0)}€</strong> a été bloquée sur ta carte pour ta réservation de la planche <em>${booking.board_title}</em>. <strong>Cette somme n'est pas débitée.</strong> Elle sera libérée automatiquement dans les 48h suivant la fin de ta session si aucun dommage n'est signalé.</p>
    <p style="margin:0 0 1rem;">En cas de dommage constaté, l'hôte peut demander une capture partielle ou totale de cette empreinte pour couvrir les frais de réparation.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:0.85rem;margin:1rem 0;font-size:0.9rem;line-height:1.6;">
      <strong>Avant de partir :</strong> Prends 4 photos de la planche au check-in (disponible dans l'app Swell). C'est ta protection en cas de litige.
    </div>
    <p style="margin:0;font-size:0.85rem;color:#6b7280;">En cas de dommage, les photos check-in/out servent de preuve à l'arbitrage Swell.</p>
  </div>
</div>`,
        tag: 'deposit-held'
      }).catch(err => console.error('[Deposits] Held email failed (non-fatal):', err.message));
    }

    res.json({ success: true, depositStatus: 'held', releaseAt: releaseAt.toISOString(), depositAmountCents: depositAmt });
  } catch (err) {
    console.error('[Deposits] Confirm error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la confirmation de la caution' });
  }
});

// POST /api/deposits/:bookingId/release — host releases the deposit early (clean checkout).
router.post('/:bookingId/release', requireAuth, async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  const booking = await getBookingById(bookingId).catch(() => null);

  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
  if (booking.host_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });
  if (booking.deposit_status !== 'held') return res.status(400).json({ error: 'Aucune caution active à libérer' });

  const depositAmt = booking.deposit_amount_cents || 0;
  const piId = booking.deposit_session_id;

  // Cancel the PaymentIntent → releases the pre-auth hold
  if (piId) {
    stripe.paymentIntents.cancel(piId).catch(err => console.error('[Deposits] Cancel PI failed (non-fatal):', err.message));
  }

  await releaseBookingDeposit(bookingId);

  if (depositAmt > 0) {
    sendTransactionalEmail({
      to: booking.renter_email,
      subject: `✓ Caution libérée — ${(depositAmt / 100).toFixed(0)}€ de nouveau disponibles sur ta carte`,
      htmlBody: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
  <div style="background:#16a34a;color:white;padding:1.5rem;border-radius:8px 8px 0 0;">
    <div style="font-size:1.5rem;margin-bottom:0.3rem;">✓</div>
    <div style="font-size:1.25rem;font-weight:700;">Empreinte bancaire libérée</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:1.5rem;background:#fff;">
    <p style="margin:0 0 1rem;">Bonjour ${booking.renter_name},</p>
    <p style="margin:0 0 1rem;">L'empreinte bancaire de <strong>${(depositAmt / 100).toFixed(0)}€</strong> bloquée pour ta réservation de <em>${booking.board_title}</em> vient d'être <strong>libérée</strong>. Elle sera de nouveau disponible sur ta carte dans les prochaines 24-48h selon ta banque.</p>
    <p style="margin:0 0 1rem;">Merci d'avoir respecté l'état de la planche — on espère que le ride était bon ! 🏄</p>
    <p style="margin:1rem 0 0;font-size:0.85rem;color:#6b7280;">N'hésite pas à laisser un avis à ton hôte — ça aide les autres surfeurs.</p>
  </div>
</div>`,
      tag: 'deposit-released'
    }).catch(err => console.error('[Deposits] Released email failed (non-fatal):', err.message));
  }

  res.json({ success: true, depositStatus: 'released' });
});

// POST /api/deposits/:bookingId/report-damage — host reports damage → admin captures.
// In MVP the capture happens via admin API; this route records the damage claim.
router.post('/:bookingId/report-damage', requireAuth, async (req, res) => {
  const { damageAmountCents, description } = req.body;
  const bookingId = parseInt(req.params.bookingId);

  if (!damageAmountCents || damageAmountCents <= 0) {
    return res.status(400).json({ error: 'Montant de dommage requis (en centimes)' });
  }

  const booking = await getBookingById(bookingId).catch(() => null);
  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
  if (booking.host_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });
  if (booking.deposit_status !== 'held') {
    return res.status(400).json({ error: 'Aucune caution active pour cette réservation' });
  }

  const captureCents = Math.min(damageAmountCents, booking.deposit_amount_cents);
  await captureBookingDeposit(bookingId, captureCents);

  // Trigger actual capture on Stripe via Polsia API
  const piId = booking.deposit_session_id;
  if (piId && captureCents > 0) {
    stripe.paymentIntents.capture(piId, { amount_to_capture: captureCents })
      .catch(err => console.error('[Deposits] Capture PI failed (non-fatal):', err.message));
  }

  res.json({
    success: true,
    depositStatus: captureCents >= booking.deposit_amount_cents ? 'captured' : 'partial_capture',
    capturedCents: captureCents,
    message: `Signalement enregistré. ${(captureCents / 100).toFixed(0)}€ de caution conservés.`
  });
});

// POST /api/deposits/cron — auto-releases expired deposit holds (48h after session end).
router.post('/cron', async (req, res) => {
  if (!CRON_SECRET) return res.status(403).json({ error: 'Cron non configuré' });
  const secret = req.headers['x-cron-secret'];
  if (secret !== CRON_SECRET) return res.status(403).json({ error: 'Secret invalide' });

  try {
    const { getExpiredDepositBookings } = require('../db/bookings');
    const expired = await getExpiredDepositBookings();
    const released = [];
    const errors = [];

    for (const booking of expired) {
      const piId = booking.deposit_session_id;
      if (piId) {
        stripe.paymentIntents.cancel(piId).catch(err => {
          console.error(`[Deposits/cron] Cancel PI failed for booking ${booking.id}:`, err.message);
          errors.push({ bookingId: booking.id, error: err.message });
        });
      }
      await releaseBookingDeposit(booking.id);
      released.push(booking.id);
    }

    console.log(`[Deposits/cron] Released ${released.length} deposits:`, released);
    if (errors.length) console.warn(`[Deposits/cron] errors:`, errors);
    res.json({ released: released.length, bookingIds: released, refundErrors: errors });
  } catch (err) {
    console.error('[Deposits/cron] Error:', err.message);
    res.status(500).json({ error: 'Erreur cron caution' });
  }
});

// GET /api/deposits/:bookingId — current deposit status for renter or host.
router.get('/:bookingId', requireAuth, async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  const booking = await getBookingById(bookingId).catch(() => null);

  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
  if (booking.renter_id !== req.session.userId && booking.host_id !== req.session.userId) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  res.json({
    depositAmountCents: booking.deposit_amount_cents || 0,
    depositStatus: booking.deposit_status || 'none',
    depositRefundAt: booking.deposit_refund_at || null
  });
});

module.exports = router;