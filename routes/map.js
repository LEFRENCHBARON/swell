// What this module owns: /map page + /api/map/* endpoints for geographic board discovery.
// Does NOT own board CRUD, booking creation, or spot metadata — those live in their respective routes.
const express = require('express');
const router = express.Router();
const { listSpotsForMap } = require('../db/spots');
const path = require('path');

// GET /api/map/spots — spots with active board counts + optional availability filter.
// ?available=1 restricts to spots with boards that have no booking conflict this week.
router.get('/api/spots', async (req, res) => {
  try {
    const filterAvailable = req.query.available === '1';

    // Week window: today → +7 days (for "dispo cette semaine" toggle)
    const today = new Date();
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);
    const fromDate = today.toISOString().split('T')[0];
    const toDate = weekEnd.toISOString().split('T')[0];

    const rows = await listSpotsForMap({ filterAvailable, fromDate, toDate });

    // Normalise photo URL — photos column is JSONB array of strings
    const spots = rows.map(row => {
      let photoUrl = null;
      if (row.sample_photo && row.sample_photo.url) {
        // Strip surrounding quotes from JSONB text cast
        photoUrl = row.sample_photo.url.replace(/^"|"$/g, '');
      }
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        lat: parseFloat(row.latitude),
        lng: parseFloat(row.longitude),
        region: row.region,
        wave_type: row.wave_type,
        level: row.level,
        board_count: parseInt(row.board_count, 10),
        min_hourly_cents: row.min_hourly_cents ? parseInt(row.min_hourly_cents, 10) : null,
        photo_url: photoUrl,
      };
    });

    res.json({ spots });
  } catch (err) {
    console.error('map spots error:', err.message);
    res.status(500).json({ error: 'Failed to load map data' });
  }
});

// GET /map — serve the discovery map page
router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'map.html'));
});

module.exports = router;
