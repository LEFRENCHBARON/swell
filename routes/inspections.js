// What this module owns: check-in / check-out photo inspections for bookings.
// Does NOT own: booking creation/status, payment, messages, reviews.
const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  getInspectionsByBooking,
  getInspection,
  createInspection,
  confirmInspection,
  getInspectionSummary,
} = require('../db/inspections');
const { getBookingById } = require('../db/bookings');

const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadToCloudinary(buffer, folder = 'swell') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (err, result) => { if (err) reject(err); else resolve(result.secure_url); }
    );
    stream.end(buffer);
  });
}


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file (before compression on client)
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Images uniquement (JPEG, PNG, WebP)'));
    }
    cb(null, true);
  },
});


function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connexion requise' });
  next();
}

// Verify caller is host or renter for this booking
async function requireBookingAccess(req, res, next) {
  try {
    const booking = await getBookingById(parseInt(req.params.bookingId));
    if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
    const userId = req.session.userId;
    if (booking.renter_id !== userId && booking.host_id !== userId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    req.booking = booking;
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function uploadToR2(buffer, _originalname, _mimetype) {
  return uploadToCloudinary(buffer, 'swell/inspections');
}

// GET /api/inspections/:bookingId — get all inspections for a booking
router.get('/:bookingId', requireAuth, requireBookingAccess, async (req, res) => {
  try {
    const inspections = await getInspectionsByBooking(parseInt(req.params.bookingId));
    res.json({ inspections });
  } catch (e) {
    res.status(500).json({ error: 'Impossible de charger les inspections' });
  }
});

// GET /api/inspections/:bookingId/summary — aggregated status for UI
// Returns which parties have submitted + confirmed for check_in and check_out
router.get('/:bookingId/summary', requireAuth, requireBookingAccess, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    const userId = req.session.userId;
    const booking = req.booking;

    const [checkInSummary, checkOutSummary] = await Promise.all([
      getInspectionSummary(bookingId, 'check_in'),
      getInspectionSummary(bookingId, 'check_out'),
    ]);

    const [myCheckIn, myCheckOut] = await Promise.all([
      getInspection(bookingId, 'check_in', userId),
      getInspection(bookingId, 'check_out', userId),
    ]);

    res.json({
      booking_id: bookingId,
      role: userId === booking.renter_id ? 'renter' : 'host',
      check_in: {
        my_submission: myCheckIn || null,
        total_submissions: parseInt(checkInSummary.total_submissions),
        total_confirmed: parseInt(checkInSummary.total_confirmed),
        both_confirmed: parseInt(checkInSummary.total_confirmed) >= 2,
      },
      check_out: {
        my_submission: myCheckOut || null,
        total_submissions: parseInt(checkOutSummary.total_submissions),
        total_confirmed: parseInt(checkOutSummary.total_confirmed),
        both_confirmed: parseInt(checkOutSummary.total_confirmed) >= 2,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Impossible de charger le résumé' });
  }
});

// POST /api/inspections/:bookingId/:type/photos — upload up to 4 photos
// Accepts multipart form with fields: photos[] (files), notes, latitude, longitude
router.post(
  '/:bookingId/:type/photos',
  requireAuth,
  requireBookingAccess,
  upload.array('photos', 4),
  async (req, res) => {
    const { type } = req.params;
    if (!['check_in', 'check_out'].includes(type)) {
      return res.status(400).json({ error: 'type doit être check_in ou check_out' });
    }

    const bookingId = parseInt(req.params.bookingId);
    const userId = req.session.userId;

    // Prevent re-submission — photos are immutable
    const existing = await getInspection(bookingId, type, userId);
    if (existing && existing.photos && existing.photos.length > 0) {
      return res.status(409).json({ error: 'Tu as déjà soumis tes photos pour cette inspection', inspection: existing });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Au moins une photo est requise' });
    }
    if (req.files.length > 4) {
      return res.status(400).json({ error: 'Maximum 4 photos par inspection' });
    }

    try {
      // Upload all photos to R2 in parallel
      const urls = await Promise.all(
        req.files.map(f => uploadToR2(f.buffer, f.originalname, f.mimetype))
      );

      const { notes, latitude, longitude } = req.body;
      const inspection = await createInspection({
        bookingId,
        type,
        userId,
        photos: urls,
        notes: notes || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
      });

      res.json({ inspection });
    } catch (e) {
      console.error('[Inspections] Upload error:', e.message);
      res.status(500).json({ error: 'Impossible d\'uploader les photos' });
    }
  }
);

// POST /api/inspections/:bookingId/:type/confirm — confirm the inspection
router.post('/:bookingId/:type/confirm', requireAuth, requireBookingAccess, async (req, res) => {
  const { type } = req.params;
  if (!['check_in', 'check_out'].includes(type)) {
    return res.status(400).json({ error: 'type doit être check_in ou check_out' });
  }

  const bookingId = parseInt(req.params.bookingId);
  const userId = req.session.userId;

  // Must have submitted photos first
  const existing = await getInspection(bookingId, type, userId);
  if (!existing || !existing.photos || existing.photos.length === 0) {
    return res.status(400).json({ error: 'Soumets d\'abord tes photos avant de confirmer' });
  }
  if (existing.confirmed_at) {
    return res.json({ inspection: existing, already_confirmed: true });
  }

  try {
    const inspection = await confirmInspection(bookingId, type, userId);
    const summary = await getInspectionSummary(bookingId, type);
    res.json({
      inspection,
      both_confirmed: parseInt(summary.total_confirmed) >= 2,
    });
  } catch (e) {
    res.status(500).json({ error: 'Impossible de confirmer' });
  }
});

module.exports = router;
