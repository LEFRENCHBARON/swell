// Consent route. Owned: server-side consent logging endpoint.
// Does NOT own: cookie banner UI, localStorage state, pixel injection.
const express = require('express');
const router = express.Router();
const { logConsent } = require('../db/consent');

// POST /api/consent/log — record consent choice server-side (CNIL proof)
router.post('/log', async (req, res) => {
  try {
    const { consent } = req.body;
    if (!consent || typeof consent !== 'object') {
      return res.status(400).json({ error: 'consent object required' });
    }

    const sessionId = req.cookies && req.cookies.swell_sid;
    const userId = req.session && req.session.userId ? req.session.userId : null;

    // anon_id: use existing swell_ref cookie as anonymous identifier,
    // reconcilable post-signup via users.referred_by_user_id path
    const anonId = req.cookies && req.cookies['swell_ref'] ? req.cookies['swell_ref'] : null;
    const bannerVersion = 'v2-cnli'; // CNIL-compliant redesign

    await logConsent({
      userId,
      sessionId,
      anonId,
      bannerVersion,
      consent: JSON.stringify(consent),
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent') || '',
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/consent/log]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;