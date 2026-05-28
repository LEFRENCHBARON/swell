// What this module owns: surf spot endpoints — list, search, nearest.
// Does NOT handle boards, bookings, or auth. Read-only endpoints.
const express = require('express');
const router = express.Router();
const { listSpots, searchSpots, getNearestSpot, getSpotBySlug } = require('../db/spots');

// GET /api/spots — all spots (for map + seed dropdowns)
router.get('/', async (req, res) => {
  try {
    const spots = await listSpots();
    res.json({ spots });
  } catch (err) {
    console.error('List spots error:', err.message);
    res.status(500).json({ error: 'Failed to load spots' });
  }
});

// GET /api/spots/search?q=hossegor — autocomplete
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ spots: [] });
    const spots = await searchSpots(q);
    res.json({ spots });
  } catch (err) {
    console.error('Search spots error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/spots/nearest?lat=43.66&lng=-1.43 — nearest spot to coordinates
router.get('/nearest', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat and lng required' });
    const spot = await getNearestSpot(lat, lng);
    res.json({ spot });
  } catch (err) {
    console.error('Nearest spot error:', err.message);
    res.status(500).json({ error: 'Failed to find nearest spot' });
  }
});

// GET /api/spots/:slug — spot detail + board count
router.get('/:slug', async (req, res) => {
  try {
    const spot = await getSpotBySlug(req.params.slug);
    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    res.json({ spot });
  } catch (err) {
    console.error('Get spot error:', err.message);
    res.status(500).json({ error: 'Failed to load spot' });
  }
});

module.exports = router;
