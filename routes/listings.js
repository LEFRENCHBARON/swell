// What this module owns: GET /listings — server-rendered board listing page.
// Generates a live grid of available boards with SEO structured data.
// Does NOT own board CRUD (routes/boards.js) or spot data (routes/spots.js).
const express = require('express');
const { listBoards } = require('../db/boards');
const { listSpots } = require('../db/spots');

const router = express.Router();
const BASE_URL = 'https://swell.polsia.app';

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GET /listings — server-rendered board listing (before static, takes priority over app.html fallback).
// CSP meta tag uses per-request nonce set by server.js middleware.
router.get('/', async (req, res) => {
  try {
    const spotFilter = req.query.spot || null;
    const allBoards = await listBoards({ limit: 200, offset: 0 });
    const boards = spotFilter
      ? allBoards.filter(b => b.spot_name && b.spot_name.toLowerCase().replace(/\//g, '-') === spotFilter.toLowerCase())
      : allBoards;
    const spots = await listSpots();
    const spotName = spotFilter
      ? (spots.find(s => s.slug === spotFilter)?.name || (spotFilter.charAt(0).toUpperCase() + spotFilter.slice(1)))
      : null;
    const pageTitle = spotName ? `Location surf ${spotName} — Planches disponibles` : 'Toutes les planches de surf à louer';

    const boardCards = boards.length > 0
      ? boards.map(b => {
          const photos = Array.isArray(b.photos) ? b.photos : [];
          const photo = photos[0] || '/og-image.png';
          const hourly = b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(0) : '?';
          return `<a href="/board/${b.id}" style="background:#1a3356;border:1px solid rgba(0,194,224,0.15);border-radius:12px;overflow:hidden;text-decoration:none;display:block;">
  <img src="${esc(photo)}" alt="${esc(b.title || 'Planche de surf sur Swell')}" loading="lazy" width="250" height="160" style="width:100%;height:160px;object-fit:cover;display:block;">
  <div style="padding:0.75rem;">
    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:#00c2e0;font-weight:600;">${esc(b.board_type || '')}</div>
    <div style="font-weight:700;color:#f0f4f8;margin:0.25rem 0;font-size:0.95rem;">${esc(b.title || '')}</div>
    <div style="color:rgba(240,244,248,0.7);font-size:0.82rem;">📍 ${esc(b.spot_name || b.location || '')}</div>
    <div style="font-size:1.1rem;font-weight:800;color:#ff6b35;margin-top:0.5rem;">${hourly}€/h</div>
  </div>
</a>`;}).join('')
      : '<p style="color:rgba(240,244,248,0.7);">Aucune planche disponible pour ce spot. <a href="/app.html" style="color:#00c2e0;">Voir toutes les planches →</a></p>';

    const canonical = spotFilter ? `${BASE_URL}/listings?spot=${spotFilter}` : `${BASE_URL}/listings`;
    const itemListEl = boards.slice(0, 20).map((b, i) => `
    {
      "@type": "ListItem",
      "position": ${i + 1},
      "item": { "@type": "Product", "name": "${esc(b.title || '')}", "url": "${BASE_URL}/board/${b.id}" }
    }`).join('');

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'nonce-${res.locals.cspNonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; upgrade-insecure-requests;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(pageTitle)} | Swell</title>
  <meta name="description" content="Trouve une planche de surf à ${esc(spotName || 'louer')} sur Swell. Location entre surfeurs locaux — de 5€/h, assurance incluse.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="Location de planches de surf entre surfeurs locaux">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "${esc(pageTitle)}",
    "numberOfItems": ${boards.length},
    "itemListElement": [${itemListEl}
    ]
  }
  </script>
</head>
<body style="background:#0e1e36;margin:0;font-family:'Space Grotesk',system-ui,sans-serif;">
  <nav style="padding:1rem;background:rgba(14,30,54,0.95);border-bottom:1px solid rgba(0,194,224,0.15);display:flex;justify-content:space-between;align-items:center;">
    <a href="/" style="color:#f0f4f8;text-decoration:none;font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;">Qiv<em style="color:#00c2e0;">er</em></a>
    <a href="/app.html" style="background:#00c2e0;color:#09152a;padding:0.5rem 1rem;border-radius:100px;font-weight:700;text-decoration:none;">🏄 Louer une planche</a>
  </nav>
  <main style="max-width:900px;margin:0 auto;padding:2rem 1rem;">
    <h1 style="color:#f0f4f8;margin-bottom:0.5rem;font-size:1.6rem;">${esc(pageTitle)}</h1>
    <p style="color:rgba(240,244,248,0.7);margin-bottom:1.5rem;">${boards.length} planche${boards.length !== 1 ? 's' : ''} disponible${boards.length !== 1 ? 's' : ''}</p>
    ${spotFilter ? `<div style="margin-bottom:1.5rem;"><a href="/listings" style="color:#00c2e0;font-weight:600;">← Toutes les planches</a></div>` : ''}
    <div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));">
      ${boardCards}
    </div>
    <div style="margin-top:2rem;text-align:center;">
      <a href="/app.html" style="display:inline-block;background:#ff6b35;color:white;padding:0.85rem 2rem;border-radius:100px;font-weight:700;text-decoration:none;">Explorer toutes les planches →</a>
    </div>
  </main>
  <footer style="border-top:1px solid rgba(0,194,224,0.15);padding:2rem;text-align:center;color:rgba(240,244,248,0.45);font-size:0.82rem;">
    © 2026 Swell — Location de planches entre surfeurs. <a href="/cgv" style="color:rgba(240,244,248,0.45);">CGV</a> · <a href="/confidentialite" style="color:rgba(240,244,248,0.45);">Confidentialité</a>
  </footer>
</body>
</html>`;
    res.type('html').send(html);
  } catch (err) {
    console.error('/listings error:', err);
    res.redirect('/app.html');
  }
});

module.exports = router;