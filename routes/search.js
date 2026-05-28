// What this module owns: /api/search — board search with filters (dates, type, price, skill, spot, verifiedOnly).
// Does NOT handle board CRUD, bookings, or availability writes — those stay in their own routes.
const express = require('express');
const router = express.Router();
const { searchBoards, countSearchBoards } = require('../db/boards');
const { searchSpots } = require('../db/spots');

// GET /api/search?from=&to=&type=fish,shortboard&minPrice=5&maxPrice=30&skill=intermediate&spotId=3&verified=1&limit=24&offset=0
router.get('/', async (req, res) => {
  try {
    const {
      from, to, type, minPrice, maxPrice, skill, spotId, verified, limit, offset
    } = req.query;

    // type can be comma-separated: "fish,shortboard"
    const boardTypes = type ? type.split(',').map(t => t.trim()).filter(Boolean) : null;

    const params = {
      fromDate: from || null,
      toDate: to || null,
      boardTypes: boardTypes && boardTypes.length > 0 ? boardTypes : null,
      minPrice: minPrice != null && minPrice !== '' ? parseFloat(minPrice) : null,
      maxPrice: maxPrice != null && maxPrice !== '' ? parseFloat(maxPrice) : null,
      skillLevel: skill || null,
      spotId: spotId ? parseInt(spotId) : null,
      verifiedOnly: verified === '1' || verified === 'true',
      limit: Math.min(parseInt(limit) || 24, 48),
      offset: parseInt(offset) || 0,
    };

    const [boards, total] = await Promise.all([
      searchBoards(params),
      countSearchBoards(params),
    ]);

    res.json({ boards, total, limit: params.limit, offset: params.offset });
  } catch (err) {
    console.error('[Search] GET /api/search error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la recherche' });
  }
});

// GET /api/search/spots?q=hossegor — autocomplete for spot picker
router.get('/spots', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) return res.json({ spots: [] });
    const spots = await searchSpots(q.trim());
    res.json({ spots });
  } catch (err) {
    console.error('[Search] GET /api/search/spots error:', err.message);
    res.status(500).json({ error: 'Erreur autocomplete spots' });
  }
});

module.exports = router;
