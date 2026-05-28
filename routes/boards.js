// What this module owns: board CRUD, search, photo upload.
// Does NOT handle bookings or reviews — those are separate routes.
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { listBoards, getBoardById, createBoard, updateBoard, delistBoard, relistBoard, getFutureBookingsCount, getBoardsByHost, getReviewsForBoard, deleteBoard, getInstantBoards, getRelatedBoards } = require('../db/boards');
const { becomeHost, getIdentityStatus, isEmailVerified } = require('../db/users');

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


// Strips any photo URL pointing to a known 3rd-party CDN.
// Keep our own R2 URLs (polsia.com / r2.dev) — those are owned assets.
const BLOCKED_PHOTO_HOSTS = ['unsplash.com', 'images.unsplash.com', 'picsum.photos', 'googleusercontent.com'];
function sanitizePhotos(photos, placeholder = '/og-image.svg') {
  if (!Array.isArray(photos)) return [];
  return photos.map(p => {
    if (typeof p !== 'string') return placeholder;
    try {
      const host = new URL(p).hostname;
      return BLOCKED_PHOTO_HOSTS.includes(host) ? placeholder : p;
    } catch {
      return p; // local path — keep it
    }
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  // Reject non-image uploads early — prevents storing garbage in R2
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptées (JPEG, PNG, WEBP)'), false);
  },
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

async function uploadPhoto(fileBuffer, _filename, _mimetype) {
  return uploadToCloudinary(fileBuffer, 'swell/boards');
}

// GET /api/boards — search and browse, supports spot_id and lat/lng for distance sort
router.get('/', async (req, res) => {
  try {
    const { region, type, minPrice, maxPrice, skill, spotId, spotLat, spotLng, limit, offset } = req.query;
    const boards = await listBoards({
      region,
      boardType: type,
      minPrice: minPrice ? parseFloat(minPrice) : null,
      maxPrice: maxPrice ? parseFloat(maxPrice) : null,
      skillLevel: skill,
      spotId: spotId ? parseInt(spotId) : null,
      spotLat: spotLat ? parseFloat(spotLat) : null,
      spotLng: spotLng ? parseFloat(spotLng) : null,
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0
    });
    // Strip any 3rd-party hotlinked photo URLs.
    boards.forEach(b => { b.photos = sanitizePhotos(b.photos); });
    res.json({ boards });
  } catch (err) {
    console.error('List boards error:', err.message);
    res.status(500).json({ error: 'Failed to load boards' });
  }
});

// GET /api/boards/my — current user's own boards (auth required); must be before /:id
router.get('/my', requireAuth, async (req, res) => {
  try {
    const boards = await getBoardsByHost(req.session.userId);
    boards.forEach(b => { b.photos = sanitizePhotos(b.photos); });
    res.json({ boards });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load boards' });
  }
});

// GET /api/boards/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid board ID' });
    const board = await getBoardById(id);
    if (!board) return res.status(404).json({ error: 'Board not found' });
    // Delisted boards are invisible to non-owners on the marketplace.
    if (!board.is_listed && board.host_id !== req.session.userId) {
      return res.status(410).json({ error: 'Cette planche n\'est plus disponible' });
    }
    // Strip any 3rd-party hotlinked photo URLs — replace with placeholder.
    board.photos = sanitizePhotos(board.photos);
    const reviews = await getReviewsForBoard(board.id);
    const related = await getRelatedBoards(board.id, board.spot_id, board.spot_lat, board.spot_lng, board.board_type, 6);
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
    res.json({ board, reviews, related });
  } catch (err) {
    console.error('Get board error:', err.message);
    res.status(500).json({ error: 'Failed to load board' });
  }
});

// POST /api/boards — create listing (host only)
router.post('/', requireAuth, upload.array('photos', 8), async (req, res) => {
  try {
    const verified = await isEmailVerified(req.session.userId);
    if (!verified) return res.status(403).json({ error: 'Vérifie ton email pour lister une board.' });

    const { title, description, boardType, lengthFt, condition, dailyPrice, hourlyRate, location, region, skillLevel, finsIncluded, leashIncluded, bagIncluded, damageWaiverEnabled, spotId, estimatedValue } = req.body;

    if (!title || !boardType || !dailyPrice || !location) {
      return res.status(400).json({ error: 'title, boardType, dailyPrice, and location are required' });
    }

    // spot_id is required so boards appear on spot pages and map filters work correctly
    if (!spotId) {
      return res.status(400).json({ error: 'Le spot est obligatoire — sélectionnez le spot de surf le plus proche sur la carte.' });
    }

    // Minimum 3 photos required for listing quality
    if (!req.files || req.files.length < 3) {
      return res.status(400).json({ error: 'Ajoutez au moins 3 photos pour publier votre annonce (face, arrière, vue globale)' });
    }

    // Make the user a host if not already
    await becomeHost(req.session.userId);

    // Check identity verification — unverified hosts can create boards but they start unlisted.
    // The board activates automatically when the host's identity is approved.
    const identityRecord = await getIdentityStatus(req.session.userId);
    const hostVerified = identityRecord?.identity_status === 'verified';

    // Upload photos
    const photoUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadPhoto(file.buffer, file.originalname, file.mimetype);
        photoUrls.push(url);
      }
    }

    const board = await createBoard({
      hostId: req.session.userId,
      title,
      description,
      boardType,
      lengthFt: lengthFt ? parseFloat(lengthFt) : null,
      condition: condition || 'good',
      dailyPriceCents: Math.round(parseFloat(dailyPrice) * 100),
      hourlyRateCents: hourlyRate ? Math.round(parseFloat(hourlyRate) * 100) : null,
      location,
      region: region || 'hossegor',
      photos: photoUrls,
      finsIncluded: finsIncluded === 'true' || finsIncluded === true,
      leashIncluded: leashIncluded === 'true' || leashIncluded === true,
      bagIncluded: bagIncluded === 'true' || bagIncluded === true,
      skillLevel: skillLevel || 'all',
      damageWaiverEnabled: damageWaiverEnabled !== 'false' && damageWaiverEnabled !== false,
      spotId: spotId ? parseInt(spotId) : null,
      // estimatedValue in euros from the wizard; convert to cents for storage
      estimatedValueCents: estimatedValue ? Math.round(parseFloat(estimatedValue) * 100) : null,
      // Board is only listed immediately if the host's identity is already verified.
      isListed: hostVerified
    });

    // pending_kyc: true tells the frontend to show the KYC activation prompt instead of "live" state.
    res.json({ board, pending_kyc: !hostVerified });
  } catch (err) {
    console.error('Create board error:', err.message);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

// PUT /api/boards/:id — update listing (full edit, owner only)
router.put('/:id', requireAuth, upload.array('photos', 8), async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!boardId || isNaN(boardId)) return res.status(400).json({ error: 'Invalid board ID' });

    // Ownership check before doing anything
    const existing = await getBoardById(boardId);
    if (!existing) return res.status(404).json({ error: 'Board not found' });
    if (existing.host_id !== req.session.userId) return res.status(403).json({ error: 'Not your listing' });

    const fields = {};

    // Text & enum fields
    const simpleFields = ['title', 'description', 'condition', 'skill_level', 'board_type', 'length_ft'];
    for (const key of simpleFields) {
      if (req.body[key] !== undefined) fields[key] = req.body[key];
    }

    // Pricing (cents conversion)
    if (req.body.dailyPrice !== undefined) {
      fields['daily_price_cents'] = req.body.dailyPrice ? Math.round(parseFloat(req.body.dailyPrice) * 100) : null;
    }
    if (req.body.hourlyRate !== undefined && req.body.hourlyRate !== '') {
      fields['hourly_rate_cents'] = req.body.hourlyRate ? Math.round(parseFloat(req.body.hourlyRate) * 100) : null;
    }

    // Flags
    if (req.body.isAvailable !== undefined) {
      fields['is_available'] = req.body.isAvailable === 'true' || req.body.isAvailable === true;
    }
    if (req.body.damageWaiverEnabled !== undefined) {
      fields['damage_waiver_enabled'] = req.body.damageWaiverEnabled === 'true' || req.body.damageWaiverEnabled === true;
    }
    if (req.body.finsIncluded !== undefined) {
      fields['fins_included'] = req.body.finsIncluded === 'true' || req.body.finsIncluded === true;
    }
    if (req.body.leashIncluded !== undefined) {
      fields['leash_included'] = req.body.leashIncluded === 'true' || req.body.leashIncluded === true;
    }
    if (req.body.bagIncluded !== undefined) {
      fields['bag_included'] = req.body.bagIncluded === 'true' || req.body.bagIncluded === true;
    }

    // Location / spot
    if (req.body.location !== undefined) fields['location'] = req.body.location;
    if (req.body.region !== undefined) fields['region'] = req.body.region;
    if (req.body.spotId !== undefined) {
      fields['spot_id'] = req.body.spotId ? parseInt(req.body.spotId) : null;
    }
    if (req.body.latitude !== undefined && req.body.longitude !== undefined) {
      fields['latitude'] = req.body.latitude ? parseFloat(req.body.latitude) : null;
      fields['longitude'] = req.body.longitude ? parseFloat(req.body.longitude) : null;
    }
    if (req.body.estimatedValue !== undefined) {
      fields['estimated_value_cents'] = req.body.estimatedValue ? Math.round(parseFloat(req.body.estimatedValue) * 100) : null;
    }

    // Photo handling: existingPhotos (array of URLs to keep) + new file uploads
    const hasNewFiles = req.files && req.files.length > 0;
    const hasExistingPhotos = req.body.existingPhotos !== undefined;
    if (hasNewFiles || hasExistingPhotos) {
      const newPhotoUrls = [];
      if (hasNewFiles) {
        for (const file of req.files) {
          const url = await uploadPhoto(file.buffer, file.originalname, file.mimetype);
          newPhotoUrls.push(url);
        }
      }
      const existing = req.body.existingPhotos ? JSON.parse(req.body.existingPhotos) : [];
      fields['photos'] = JSON.stringify([...existing, ...newPhotoUrls]);
    }

    if (Object.keys(fields).length === 0 && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Enforce minimum 3 photos — editing cannot drop below 3
    if (fields.photos) {
      const parsed = JSON.parse(fields.photos);
      if (parsed.length < 3) {
        return res.status(400).json({ error: 'Minimum 3 photos required — gardez au moins 3 photos.' });
      }
    }

    const board = await updateBoard(boardId, req.session.userId, fields);
    if (!board) return res.status(404).json({ error: 'Board not found or not your listing' });
    res.json({ board });
  } catch (err) {
    console.error('Update board error:', err.message);
    res.status(500).json({ error: 'Failed to update listing' });
  }
});

// POST /api/boards/:id/delist — hide board from marketplace (reversible)
// Returns 409 with activeBookings count if host has future confirmed/pending bookings.
router.post('/:id/delist', requireAuth, async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!boardId || isNaN(boardId)) return res.status(400).json({ error: 'Invalid board ID' });
    const userId = req.session.userId;
    const { force } = req.body;

    // Warn if active bookings unless host explicitly forces
    if (!force) {
      const count = await getFutureBookingsCount(boardId, userId);
      if (count > 0) {
        return res.status(409).json({ activeBookings: count });
      }
    }

    const ok = await delistBoard(boardId, userId);
    if (!ok) return res.status(404).json({ error: 'Board not found or not your listing' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delist board' });
  }
});

// POST /api/boards/:id/relist — restore board to marketplace
router.post('/:id/relist', requireAuth, async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!boardId || isNaN(boardId)) return res.status(400).json({ error: 'Invalid board ID' });
    const ok = await relistBoard(boardId, req.session.userId);
    if (!ok) return res.status(404).json({ error: 'Board not found or not your listing' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to relist board' });
  }
});

// GET /api/boards/:id/can-delete — lightweight check (no side effects)
router.get('/:id/can-delete', requireAuth, async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!boardId || isNaN(boardId)) return res.status(400).json({ error: 'Invalid board ID' });
    const userId = req.session.userId;
    // Check if board belongs to user first
    const board = await getBoardById(boardId);
    if (!board || board.host_id !== userId) return res.status(404).json({ error: 'Board not found or not your listing' });
    const count = await getFutureBookingsCount(boardId, userId);
    res.json({ canDelete: count === 0, activeBookings: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check board status' });
  }
});

// DELETE /api/boards/:id — permanent deletion with cascade (pre-checked for active bookings)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!boardId || isNaN(boardId)) return res.status(400).json({ error: 'Invalid board ID' });
    const userId = req.session.userId;

    // Re-check on every delete call — protects against race condition if user confirmed
    const count = await getFutureBookingsCount(boardId, userId);
    if (count > 0) {
      return res.status(400).json({
        error: 'Impossible de supprimer : réservation(s) en cours',
        activeBookings: count
      });
    }

    const result = await deleteBoard(boardId, userId);
    if (!result) return res.status(404).json({ error: 'Board not found or not your listing' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete board error:', err.message);
    res.status(500).json({ error: 'Failed to delete board' });
  }
});

// GET /api/boards/host/:userId
router.get('/host/:userId', async (req, res) => {
  try {
    const boards = await getBoardsByHost(parseInt(req.params.userId));
    boards.forEach(b => { b.photos = sanitizePhotos(b.photos); });
    res.json({ boards });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load host boards' });
  }
});

// GET /api/boards/instant — homepage 'Disponibles maintenant' surface.
// Returns boards with open hourly slots in next 24h, stripe-verified host,
// and ≥3 photos. Sorted: verified hosts first, then by completed bookings.
router.get('/instant', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 6, 12);
    const boards = await getInstantBoards({ limit });
    res.json({ boards });
  } catch (err) {
    console.error('GET /api/boards/instant:', err);
    res.status(500).json({ error: 'Failed to load instant boards' });
  }
});

module.exports = router;
