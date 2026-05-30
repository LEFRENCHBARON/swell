// What this module owns: booking creation, status updates, availability checks, payment initiation.
// Does NOT own: Stripe account config, payment verification logic (delegated to Polsia payment API), deposit lifecycle (see routes/deposits.js).
const express = require('express');
const router = express.Router();
const { checkAvailability, getBookedDates, createBooking, getBookingById, updateBookingStatus, getBookingsForRenter, getBookingsForHost, updateBookingPayment, getBookingBySessionId, getBookingConfirmationData, getRenterSurfLevel } = require('../db/bookings');
const { appendRentalEvent } = require('../db/events');
const { getBoardById } = require('../db/boards');
const { isEmailVerified } = require('../db/users');
const { blockDateRange } = require('../db/availability');
const { getBoardHostPaymentStatus } = require('../db/stripe-connect');
const { validatePromoCode, calcPromoDiscount, recordPromoRedemption } = require('../db/promoCodes');
const { grantReferralCredits } = require('../db/referrals');
const { sendBookingConfirmationEmails } = require('../services/booking-emails');
const Stripe = require('stripe');
// Lazy init — Stripe v17 throws synchronously if key is undefined, blocking app.listen
let _stripe;
function getStripe() { return _stripe || (_stripe = new Stripe(process.env.STRIPE_SECRET_KEY)); }


// Service fee charged to the renter (Swell commission on rental amount only, not waiver)
const SERVICE_FEE_RATE = 0.12;

const APP_URL = process.env.APP_URL || 'https://swell.polsia.app';

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// Deposit = 50% of board estimated value, min 50€, max 500€. Zero if no value declared.
function calcDepositCents(estimatedValueCents) {
  if (!estimatedValueCents || estimatedValueCents <= 0) return 0;
  const half = Math.round(estimatedValueCents * 0.5);
  return Math.min(Math.max(half, 5000), 50000);
}

// GET /api/bookings/availability/:boardId
router.get('/availability/:boardId', async (req, res) => {
  try {
    const bookedDates = await getBookedDates(parseInt(req.params.boardId));
    res.json({ bookedDates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// POST /api/bookings/check — supports both daily (legacy) and hourly bookings
router.post('/check', async (req, res) => {
  const { boardId, startDate, endDate, startTime, endTime } = req.body;
  if (!boardId || !startDate || !endDate) {
    return res.status(400).json({ error: 'boardId, startDate, endDate required' });
  }
  try {
    const board = await getBoardById(parseInt(boardId));
    if (!board) return res.status(404).json({ error: 'Board not found' });

    // Hourly model if startTime/endTime provided
    const isHourly = !!(startTime && endTime);

    if (isHourly) {
      const sh = parseInt(startTime.split(':')[0]);
      const eh = parseInt(endTime.split(':')[0]);
      const hours = eh - sh;
      if (hours < 2 || hours > 16) {
        return res.status(400).json({ error: 'La durée doit être entre 2h et 16h' });
      }
      const { isSlotAvailable } = require('../db/availability');
      const available = await isSlotAvailable(parseInt(boardId), startDate, sh, eh);
      if (!available) return res.status(409).json({ error: 'Ce créneau n\u2019est pas disponible' });

      const hourlyRate = board.hourly_rate_cents || Math.round(board.daily_price_cents / 8);
      const rentalCents = hours * hourlyRate;
      const damageWaiverCents = board.damage_waiver_enabled ? Math.round(hours * 50) : 0;
      const serviceFeeCents = Math.round(rentalCents * SERVICE_FEE_RATE);
      const depositCents = calcDepositCents(board.estimated_value_cents);

      const totalCents = rentalCents + damageWaiverCents + serviceFeeCents;
      res.json({
        available: true, isHourly: true, hours,
        rentalCents, damageWaiverCents, serviceFeeCents, depositCents,
        estimatedValueCents: board.estimated_value_cents || 0,
        hourlyRateCents: hourlyRate,
        damageWaiverEnabled: board.damage_waiver_enabled,
        totalCents,
        waiver_total: damageWaiverCents / 100,
        grand_total: totalCents / 100,
        startTime, endTime
      });
    } else {
      // Legacy daily model
      const available = await checkAvailability(parseInt(boardId), startDate, endDate);
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      const rentalCents = days * board.daily_price_cents;
      const waiverPerDayCents = 500;
      const damageWaiverCents = board.damage_waiver_enabled ? days * waiverPerDayCents : 0;
      const serviceFeeCents = Math.round(rentalCents * SERVICE_FEE_RATE);
      const depositCents = calcDepositCents(board.estimated_value_cents);

      const totalCents = rentalCents + damageWaiverCents + serviceFeeCents;
      res.json({
        available, days, isHourly: false,
        rentalCents, damageWaiverCents, serviceFeeCents, depositCents,
        estimatedValueCents: board.estimated_value_cents || 0,
        waiverPerDayCents: board.damage_waiver_enabled ? waiverPerDayCents : 0,
        damageWaiverEnabled: board.damage_waiver_enabled,
        totalCents,
        waiver_total: damageWaiverCents / 100,
        grand_total: totalCents / 100,
        dailyPriceCents: board.daily_price_cents
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// POST /api/bookings — create booking and return Stripe checkout URL
router.post('/', requireAuth, async (req, res) => {
  const { boardId, startDate, endDate, startTime, endTime, message, damageWaiver, promoCode } = req.body;
  if (!boardId || !startDate || !endDate) {
    return res.status(400).json({ error: 'boardId, startDate, endDate required' });
  }

  try {
    const verified = await isEmailVerified(req.session.userId);
    if (!verified) return res.status(403).json({ error: 'Vérifie ton email pour réserver.' });

    const board = await getBoardById(parseInt(boardId));
    if (!board) return res.status(404).json({ error: 'Board not found' });
    if (board.host_id === req.session.userId) {
      return res.status(400).json({ error: 'Cannot book your own board' });
    }

    const hostPayment = await getBoardHostPaymentStatus(parseInt(boardId));
    if (!hostPayment || !hostPayment.stripe_charges_enabled) {
      return res.status(402).json({ error: 'Ce host n\u2019a pas encore configur\u00e9 ses paiements. R\u00e9servation impossible pour l\u2019instant.' });
    }

    const isHourly = !!(startTime && endTime);
    let rentalCents, damageWaiverCents, serviceFeeCents, totalCents, totalEuros, hours;

    if (isHourly) {
      const sh = parseInt(startTime.split(':')[0]);
      const eh = parseInt(endTime.split(':')[0]);
      hours = eh - sh;
      if (hours < 2 || hours > 16) {
        return res.status(400).json({ error: 'La dur\u00e9e doit \u00eatre entre 2h et 16h' });
      }
      const { isSlotAvailable } = require('../db/availability');
      const available = await isSlotAvailable(parseInt(boardId), startDate, sh, eh);
      if (!available) return res.status(409).json({ error: 'Ce cr\u00e9neau n\u2019est plus disponible' });

      const hourlyRate = board.hourly_rate_cents || Math.round(board.daily_price_cents / 8);
      rentalCents = hours * hourlyRate;
      damageWaiverCents = (board.damage_waiver_enabled && damageWaiver) ? Math.round(hours * 50) : 0;
      serviceFeeCents = Math.round(rentalCents * SERVICE_FEE_RATE);
      totalCents = rentalCents + damageWaiverCents + serviceFeeCents;
    } else {
      const available = await checkAvailability(parseInt(boardId), startDate, endDate);
      if (!available) return res.status(409).json({ error: 'Board is not available for those dates' });

      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      if (days < 1) return res.status(400).json({ error: 'End date must be after start date' });

      rentalCents = days * board.daily_price_cents;
      const waiverPerDayCents = 500;
      damageWaiverCents = (board.damage_waiver_enabled && damageWaiver) ? days * waiverPerDayCents : 0;
      serviceFeeCents = Math.round(rentalCents * SERVICE_FEE_RATE);
      totalCents = rentalCents + damageWaiverCents + serviceFeeCents;
    }

    // Apply promo discount — reduces rider total; host net is unchanged (discount on service fee first, then rental)
    let promoDiscountCents = 0;
    let validatedPromoCode = null;
    if (promoCode) {
      const promo = await validatePromoCode(promoCode, req.session.userId, isHourly);
      if (promo.valid) {
        promoDiscountCents = calcPromoDiscount(rentalCents, promo.discountPct, promo.maxDiscountCents);
        validatedPromoCode = promo.code;
        totalCents = Math.max(0, totalCents - promoDiscountCents);
      }
      // If invalid, silently ignore — don't fail the booking for a bad code at this stage
    }

    totalEuros = totalCents / 100;

    const booking = await createBooking({
      boardId: parseInt(boardId),
      renterId: req.session.userId,
      startDate, endDate,
      startTime: startTime || null,
      endTime: endTime || null,
      durationHours: hours || null,
      totalCents,
      damageWaiverCents,
      message,
      promoCode: validatedPromoCode,
      promoDiscountCents: promoDiscountCents || null
    });

    const startFmt = new Date(startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const productName = isHourly
      ? `Location ${board.title} \u2014 ${startFmt}, ${startTime}\u2013${endTime}`
      : `Location ${board.title} \u2014 ${startFmt} au ${new Date(endDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
    const successUrl = `${APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`;
    const cancelUrl = `${APP_URL}/payment/cancel?booking_id=${booking.id}`;

    let checkoutUrl = null;
    let stripeSessionId = null;

    try {
      const session = await getStripe().checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'eur',
            unit_amount: totalCents,
            product_data: { name: productName },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { booking_id: String(booking.id) },
      });
      checkoutUrl = session.url;
      stripeSessionId = session.id;
    } catch (payErr) {
      console.error('[Bookings] Stripe error:', payErr.message);
    }

    if (checkoutUrl && stripeSessionId) {
      await updateBookingPayment(booking.id, {
        paymentStatus: 'pending',
        stripeSessionId,
        stripePaymentLink: checkoutUrl
      });
    }

    const depositCents = calcDepositCents(board.estimated_value_cents);

    // Record promo redemption after booking is created (best-effort; non-fatal)
    if (validatedPromoCode && promoDiscountCents > 0) {
      recordPromoRedemption(req.session.userId, booking.id, validatedPromoCode, promoDiscountCents)
        .catch(err => console.error('[Bookings] recordPromoRedemption failed (non-fatal):', err.message));
    }

    res.json({
      booking,
      checkoutUrl,
      totalCents,
      rentalCents,
      damageWaiverCents,
      serviceFeeCents,
      promoDiscountCents,
      promoCode: validatedPromoCode,
      depositCents,
      hours,
      isHourly
    });
  } catch (err) {
    console.error('Create booking error:', err.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// POST /api/bookings/payment-verify — verify Stripe payment and confirm booking.
// Security: the sessionId in the request MUST match the sessionId stored on the booking.
// This prevents the exploit: paying for booking A then calling verify with booking B's ID.
router.post('/payment-verify', requireAuth, async (req, res) => {
  const { sessionId, bookingId } = req.body;
  if (!sessionId || !bookingId) {
    return res.status(400).json({ error: 'sessionId and bookingId required' });
  }

  try {
    let stripeVerified = false;
    try {
      const stripeSession = await getStripe().checkout.sessions.retrieve(sessionId);
      stripeVerified = stripeSession.payment_status === 'paid';
    } catch (err) {
      return res.status(402).json({ error: 'Payment not verified' });
    }
    if (!stripeVerified) {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const booking = await getBookingById(parseInt(bookingId));
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.renter_id !== req.session.userId) return res.status(403).json({ error: 'Access denied' });

    // SECURITY: session ID must match the one stored on the booking.
    // Case 1: booking already has a stored session ID — must match exactly.
    // Case 2: no stored session ID (payment API was temporarily down) — look up the session
    //         in our DB to confirm it belongs to this booking, not someone else's.
    if (booking.stripe_session_id) {
      if (booking.stripe_session_id !== sessionId) {
        console.error(`[SECURITY] payment-verify mismatch: session=${sessionId} tried to confirm booking=${bookingId} (belongs to session=${booking.stripe_session_id}), userId=${req.session.userId}, ip=${req.ip}`);
        return res.status(403).json({ error: 'Session does not match this booking' });
      }
    } else {
      // No session stored on booking — verify the session ID resolves to THIS booking, not another.
      const sessionBooking = await getBookingBySessionId(sessionId);
      if (sessionBooking && sessionBooking.id !== parseInt(bookingId)) {
        console.error(`[SECURITY] payment-verify cross-booking: session=${sessionId} belongs to booking=${sessionBooking.id}, but request claims booking=${bookingId}, userId=${req.session.userId}, ip=${req.ip}`);
        return res.status(403).json({ error: 'Session does not match this booking' });
      }
    }

    await updateBookingPayment(booking.id, {
      paymentStatus: 'paid',
      stripeSessionId: sessionId,
      stripePaymentLink: booking.stripe_payment_link
    });
    await updateBookingStatus(booking.id, 'confirmed', req.session.userId);

    // ── Deposit pre-auth: fires INSIDE the booking flow after confirmation.
    // Non-blocking — booking is confirmed regardless of deposit outcome.
    // The deposit hold uses capture_method=manual (pre-auth, not captured yet).
    // Refactored inline to avoid circular HTTP call within the same Express app.
    (async () => {
      try {
        const { getBoardById } = require('../db/boards');
        const { updateBookingDeposit } = require('../db/bookings');
        const board = await getBoardById(booking.board_id);
        if (!board?.estimated_value_cents) return;
        const depositCents = (() => {
          if (!board.estimated_value_cents || board.estimated_value_cents <= 0) return 0;
          const half = Math.round(board.estimated_value_cents * 0.5);
          return Math.min(Math.max(half, 5000), 50000);
        })();
        if (depositCents === 0) return;

        const pi = await getStripe().paymentIntents.create({
          amount: depositCents,
          currency: 'eur',
          capture_method: 'manual',
          metadata: {
            booking_id: String(booking.id),
            type: 'deposit_hold',
            reference: `deposit-${booking.id}-${board.id}`
          },
          description: "Caution Swell — non débitée. Libérée 48h après la session.",
        });
        const piId = pi.id;
        if (!piId) return;

        await updateBookingDeposit(booking.id, {
          depositAmountCents: depositCents,
          depositSessionId: piId,
          depositStatus: 'pending_hold',
          depositRefundAt: null
        });
        console.log(`[Bookings] Deposit PI created for booking ${booking.id}: ${piId}`);
      } catch (err) {
        console.error('[Bookings] Deposit pre-auth failed (non-fatal):', err.message);
      }
    })();

    await blockDateRange(booking.board_id, booking.start_date, booking.end_date).catch(err => {
      console.error('[Bookings] blockDateRange failed (non-fatal):', err.message);
    });

    // Grant referral credits when first paid booking completes (non-fatal)
    grantReferralCredits(req.session.userId, booking.id).catch(err =>
      console.error('[Bookings] grantReferralCredits failed (non-fatal):', err.message)
    );

    // Send confirmation emails to both renter and host (non-fatal — never block the response)
    getBookingConfirmationData(booking.id).then(confirmData => {
      if (!confirmData) return;
      // Reconstitute amounts from the booking row (fields may be 0 if not stored)
      const rentalCents = confirmData.total_cents
        - (confirmData.damage_waiver_cents || 0)
        - Math.round((confirmData.total_cents - (confirmData.damage_waiver_cents || 0)) * 0.12 / 1.12);
      const waiverCents   = confirmData.damage_waiver_cents || 0;
      const serviceCents  = Math.round(rentalCents * 0.12);
      const depositCents  = confirmData.deposit_amount_cents || 0;
      return sendBookingConfirmationEmails(confirmData, {
        rentalCents,
        damageWaiverCents: waiverCents,
        serviceFeeCents:   serviceCents,
        totalCents:        confirmData.total_cents || 0,
        depositCents
      });
    }).catch(err =>
      console.error('[Bookings] sendBookingConfirmationEmails failed (non-fatal):', err.message)
    );

    res.json({ success: true, booking: { ...booking, payment_status: 'paid', status: 'confirmed' }, payment });
  } catch (err) {
    console.error('Payment verify error:', err.message);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// POST /api/bookings/expire-stale — manually trigger stale pending → expired transition.
// Secured by CRON_SECRET; also runs via polsia.toml cron every 15 minutes.
router.post('/expire-stale', async (req, res) => {
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (auth !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { expireStalePendingBookings } = require('../jobs/expire-stale-bookings');
    const count = await expireStalePendingBookings();
    res.json({ expired: count });
  } catch (err) {
    console.error('[expire-stale] Error:', err.message);
    res.status(500).json({ error: 'Failed to expire stale bookings' });
  }
});

// GET /api/bookings/my — renter's bookings
router.get('/my', requireAuth, async (req, res) => {
  try {
    const bookings = await getBookingsForRenter(req.session.userId);
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

// GET /api/bookings/host — host's incoming bookings
router.get('/host', requireAuth, async (req, res) => {
  try {
    const bookings = await getBookingsForHost(req.session.userId);
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

// GET /api/bookings/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const booking = await getBookingById(id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.renter_id !== req.session.userId && booking.host_id !== req.session.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ booking });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load booking' });
  }
});

// PATCH /api/bookings/:id/status
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['confirmed', 'cancelled', 'completed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const booking = await updateBookingStatus(id, status, req.session.userId);
    if (!booking) return res.status(404).json({ error: 'Booking not found or access denied' });

    // ── STAB-2: Event Store hook on booking completion ──────────────────────
    if (status === 'completed') {
      const [renterSurfLevel, board] = await Promise.all([
        getRenterSurfLevel(booking.id),
        getBoardById(booking.board_id)
      ]);
      appendRentalEvent({
        booking_id: booking.id,
        board_id: booking.board_id,
        rider_id: booking.renter_id,
        spot_id: board?.spot_id || null,
        rider_level: renterSurfLevel || 'intermediate',
        return_condition: 'unknown'
      }).catch(err => console.error('[EventStore] append failed (non-fatal):', err.message));
    }

    res.json({ booking });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

module.exports = router;