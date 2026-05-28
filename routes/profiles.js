// What this module owns: user profile reads, updates, and avatar upload.
// Does NOT handle authentication tokens — session middleware handles that.
// Review submission moved to routes/reviews.js (double-blind bidirectional system).
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getUserById, updateProfile, getPublicProfile } = require('../db/users');
const { getReviewsForUser } = require('../db/reviews');
const { getHostMetrics } = require('../db/hostEvolution');

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


const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

async function uploadAvatar(buffer, _filename, _mimetype) {
  return uploadToCloudinary(buffer, 'swell/avatars');
}

// GET /api/profiles/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// PUT /api/profiles/me
router.put('/me', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    const fields = {};
    const allowed = ['name', 'bio', 'surf_level', 'location', 'best_surf_trip_text'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) fields[key] = req.body[key];
    }

    if (req.file) {
      const avatarUrl = await uploadAvatar(req.file.buffer, req.file.originalname, req.file.mimetype);
      fields['avatar_url'] = avatarUrl;
    }

    const user = await updateProfile(req.session.userId, fields);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    console.error('Update profile error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/profiles/:id — public profile with published reviews + trust metrics
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid profile ID' });
    const profile = await getPublicProfile(id);
    if (!profile) return res.status(404).json({ error: 'User not found' });
    const reviews = await getReviewsForUser(id);
    const hostMetrics = profile.is_host ? await getHostMetrics(id) : null;
    res.json({ profile, reviews, hostMetrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

module.exports = router;
