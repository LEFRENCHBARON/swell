// What this module owns: host trust metrics reads and refresh.
// Does NOT handle tier computation — that lives in db/hostEvolution.js.
const express = require('express');
const router = express.Router();
const { getHostMetrics, refreshHostMetrics } = require('../db/hostEvolution');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// GET /api/host-metrics/me — current user's own trust metrics
router.get('/me', requireAuth, async (req, res) => {
  try {
    const metrics = await getHostMetrics(req.session.userId);
    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load host metrics' });
  }
});

// POST /api/host-metrics/me/refresh — recompute trust metrics from live DB data
router.post('/me/refresh', requireAuth, async (req, res) => {
  try {
    const metrics = await refreshHostMetrics(req.session.userId);
    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh host metrics' });
  }
});

module.exports = router;