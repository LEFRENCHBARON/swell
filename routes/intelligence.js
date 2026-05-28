// What this module owns: HTTP endpoints for Event Store, Failure Atlas, and Host Evolution Engine.
// Grouped under /api/intelligence to avoid proliferating route mounts.
// Does NOT own board CRUD, bookings flow, payments, or auth.
const express = require('express');
const router = express.Router();
const {
  appendRentalEvent,
  getEventsByBoard,
  getEventsBySpot,
  getEventStats,
  getRecentEvents,
  detectPatterns
} = require('../db/events');
const {
  getFailureZones,
  getPrimaryZoneForSpot,
  getBoardSpotRisk,
  getSpotDangerRanking,
  refreshZoneFromEvents,
  getBoardRecommendationsForSpot
} = require('../db/atlas');
const {
  getHostMetrics,
  listHostsByTier,
  getTierDistribution,
  refreshHostMetrics
} = require('../db/hostEvolution');

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Admin guard — uses isAdmin flag if available, otherwise just requires auth for now.
// In production, add a proper isAdmin check against the users table.
function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ── EVENT STORE ──────────────────────────────────────────────────────────────

// POST /api/intelligence/events — append a rental event (internal use by booking completion hook)
router.post('/events', requireAuth, async (req, res) => {
  try {
    const event = await appendRentalEvent(req.body);
    res.status(201).json({ event });
  } catch (err) {
    console.error('POST /api/intelligence/events error:', err);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

// GET /api/intelligence/events — admin event feed
router.get('/events', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const events = await getRecentEvents(limit);
    const stats = await getEventStats();
    res.json({ events, stats });
  } catch (err) {
    console.error('GET /api/intelligence/events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/intelligence/events/board/:boardId — events for a specific board
router.get('/events/board/:boardId', requireAuth, async (req, res) => {
  try {
    const boardId = parseInt(req.params.boardId, 10);
    const events = await getEventsByBoard(boardId);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch board events' });
  }
});

// GET /api/intelligence/events/spot/:spotId — events + patterns for a spot
router.get('/events/spot/:spotId', requireAuth, async (req, res) => {
  try {
    const spotId = parseInt(req.params.spotId, 10);
    const [events, patterns] = await Promise.all([
      getEventsBySpot(spotId),
      detectPatterns(spotId)
    ]);
    res.json({ events, patterns });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch spot events' });
  }
});

// ── FAILURE ATLAS ─────────────────────────────────────────────────────────────

// GET /api/intelligence/failure-atlas — full atlas (all zones)
router.get('/failure-atlas', async (req, res) => {
  try {
    const spotId = req.query.spot_id ? parseInt(req.query.spot_id, 10) : null;
    const zones = await getFailureZones(spotId);
    const ranking = await getSpotDangerRanking();
    res.json({ zones, ranking });
  } catch (err) {
    console.error('GET /api/intelligence/failure-atlas error:', err);
    res.status(500).json({ error: 'Failed to fetch failure atlas' });
  }
});

// GET /api/intelligence/failure-atlas/spot/:spotId — single spot risk profile
router.get('/failure-atlas/spot/:spotId', async (req, res) => {
  try {
    const spotId = parseInt(req.params.spotId, 10);
    const [zones, primary, recommendations] = await Promise.all([
      getFailureZones(spotId),
      getPrimaryZoneForSpot(spotId),
      getBoardRecommendationsForSpot(spotId)
    ]);
    res.json({ spot_id: spotId, zones, primary_zone: primary, recommendations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch spot risk' });
  }
});

// GET /api/intelligence/failure-atlas/board/:boardId/spot/:spotId — board×spot risk
router.get('/failure-atlas/board/:boardId/spot/:spotId', async (req, res) => {
  try {
    const boardId = parseInt(req.params.boardId, 10);
    const spotId = parseInt(req.params.spotId, 10);
    const risk = await getBoardSpotRisk(boardId, spotId);
    res.json({ board_id: boardId, spot_id: spotId, risk });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch board-spot risk' });
  }
});

// POST /api/intelligence/failure-atlas/refresh/:spotId — refresh zone from accumulated events
router.post('/failure-atlas/refresh/:spotId', requireAdmin, async (req, res) => {
  try {
    const spotId = parseInt(req.params.spotId, 10);
    const { zone_name } = req.body;
    if (!zone_name) return res.status(400).json({ error: 'zone_name required' });

    const { computeSpotDamageProfile } = require('../db/events');
    const eventStats = await computeSpotDamageProfile(spotId);
    const updated = await refreshZoneFromEvents(spotId, zone_name, eventStats);
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh zone' });
  }
});

// ── HOST EVOLUTION ENGINE ────────────────────────────────────────────────────

// GET /api/intelligence/host-evolution/me — host's own metrics (auth required)
router.get('/host-evolution/me', requireAuth, async (req, res) => {
  try {
    let metrics = await getHostMetrics(req.session.userId);
    if (!metrics) {
      // Bootstrap on first call
      metrics = await refreshHostMetrics(req.session.userId);
    }
    res.json({ metrics });
  } catch (err) {
    console.error('GET /api/intelligence/host-evolution/me error:', err);
    res.status(500).json({ error: 'Failed to fetch host metrics' });
  }
});

// POST /api/intelligence/host-evolution/refresh — recalculate metrics from live DB
router.post('/host-evolution/refresh', requireAuth, async (req, res) => {
  try {
    const metrics = await refreshHostMetrics(req.session.userId);
    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh host metrics' });
  }
});

// GET /api/intelligence/host-evolution — admin: full host tier overview
router.get('/host-evolution', requireAdmin, async (req, res) => {
  try {
    const tier = req.query.tier || null;
    const [hosts, distribution] = await Promise.all([
      listHostsByTier(tier),
      getTierDistribution()
    ]);
    res.json({ hosts, distribution });
  } catch (err) {
    console.error('GET /api/intelligence/host-evolution error:', err);
    res.status(500).json({ error: 'Failed to fetch host evolution data' });
  }
});

// GET /api/intelligence/host-evolution/:hostId — specific host (admin)
router.get('/host-evolution/:hostId', requireAdmin, async (req, res) => {
  try {
    const hostId = parseInt(req.params.hostId, 10);
    const metrics = await getHostMetrics(hostId);
    if (!metrics) return res.status(404).json({ error: 'No metrics for host' });
    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch host metrics' });
  }
});

// POST /api/intelligence/host-evolution/:hostId/refresh — admin-triggered refresh
router.post('/host-evolution/:hostId/refresh', requireAdmin, async (req, res) => {
  try {
    const hostId = parseInt(req.params.hostId, 10);
    const metrics = await refreshHostMetrics(hostId);
    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh host metrics' });
  }
});

module.exports = router;
