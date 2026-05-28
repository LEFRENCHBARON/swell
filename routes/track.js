// What this module owns: lightweight front-end analytics event receiver.
// Does NOT store events in DB — logs them server-side for future aggregation.
// Accepts map_marker_click, map_spot_view, and any future front-end events.
const express = require('express');
const router = express.Router();

// POST /api/track — fire-and-forget front-end event ingestion.
// No auth required; events are intentionally low-trust (client-side).
router.post('/', (req, res) => {
  const { event, ...props } = req.body || {};
  if (!event || typeof event !== 'string') return res.status(400).json({ error: 'event required' });
  // Log for future aggregation — extend to DB or analytics service as needed
  console.log('[track]', event, JSON.stringify(props));
  res.json({ ok: true });
});

module.exports = router;
