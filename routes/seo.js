// What this module owns: SEO endpoints — sitemap.xml, robots.txt, board detail pages.
// JSON-LD structured data for search engine rich results.
// Does NOT own authentication or board business logic.
const express = require('express');
const { listBoards, getBoardById, getReviewsForBoard, getRelatedBoards, getWeekendAvailableHours } = require('../db/boards');
const { listSpots } = require('../db/spots');

const router = express.Router();
const BASE_URL = 'https://swell.polsia.app';
// Absolute fallback — social scrapers (WhatsApp, iMessage, Twitter) require absolute OG image URLs.
const OG_IMAGE = `${BASE_URL}/og-image.svg`;

const BLOCKED_PHOTO_HOSTS = ['unsplash.com', 'images.unsplash.com', 'picsum.photos', 'googleusercontent.com'];
function sanitizePhotoUrl(url) {
  if (!url || typeof url !== 'string') return OG_IMAGE;
  try {
    const { hostname, href } = new URL(url);
    return BLOCKED_PHOTO_HOSTS.includes(hostname) ? OG_IMAGE : href;
  } catch {
    // Relative path — make absolute so OG scrapers can fetch it
    return url.startsWith('/') ? `${BASE_URL}${url}` : url;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const WAVE_LABELS = { beachbreak: 'Beach Break', reefbreak: 'Reef Break', pointbreak: 'Point Break', riverbar: 'Rivière' };
const CONDITION_LABELS = { excellent: 'Excellent', good: 'Bon', fair: 'Correct', worn: 'Usé' };
const BOARD_TYPE_LABELS = { shortboard: 'Shortboard', longboard: 'Longboard', midlength: 'Mid-Length', fish: 'Fish', funboard: 'Funboard', foam: 'Foam/Mousse' };

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Server-rendered board detail page — Google indexes this, not app.html?board=ID
// Renders: photo lightbox, social proof badges, urgency signals, WhatsApp CTA, related carousel.
async function renderBoardDetailPage(board, nonce, reviews = [], related = [], weekendHours = null) {
  const now = new Date().toISOString().split('T')[0];
  // Hourly rate with legacy fallback: pre-Jan 2025 boards may have no hourly_rate_cents
  const hourlyPrice = board.hourly_rate_cents
    ? (board.hourly_rate_cents / 100).toFixed(2)
    : board.daily_price_cents ? (board.daily_price_cents / 800).toFixed(2) : null;
  const photos = Array.isArray(board.photos) ? board.photos : (board.photos ? JSON.parse(board.photos) : []);
  const sanitizedPhotos = photos.map(p => sanitizePhotoUrl(p));
  const primaryPhoto = sanitizedPhotos[0] || OG_IMAGE;
  const boardType = BOARD_TYPE_LABELS[board.board_type] || board.board_type;
  const condition = CONDITION_LABELS[board.condition] || board.condition;
  const spot = board.spot_name || board.location || 'Hossegor';
  const avgRating = parseFloat(board.avg_rating || 0);
  const reviewCount = parseInt(board.review_count || 0, 10);
  const hostName = board.host_name || 'Hôte local';
  const title = escapeHtml(board.title);
  const locationFull = escapeHtml(board.location || board.spot_name || 'Hossegor, France');

  // Meta description — unique per board, up to 160 chars
  const metaDesc = `${boardType} ${board.length_ft ? board.length_ft + 'ft' : ''} à ${locationFull}. ${board.description ? board.description.substring(0, 80) + '…' : 'Louez cette planche auprès d\'un surfeur local.'} ${hourlyPrice}€/h (min. 2h).`;

  // JSON-LD BreadcrumbList — Home › Spots › [Spot] › [Board]
  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Swell', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Planches', item: `${BASE_URL}/app.html` },
      ...(board.spot_slug ? [{ '@type': 'ListItem', position: 3, name: spot, item: `${BASE_URL}/spot/${board.spot_slug}` }] : []),
      { '@type': 'ListItem', position: board.spot_slug ? 4 : 3, name: board.title, item: `${BASE_URL}/board/${board.id}` },
    ],
  });

  // JSON-LD Product schema
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: board.title,
    description: board.description || `${boardType} surfboard for rent in ${spot}`,
    image: sanitizedPhotos.length > 0 ? sanitizedPhotos : [primaryPhoto],
    brand: { '@type': 'Brand', name: 'Swell' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: hourlyPrice,
      priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      availability: board.is_available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${BASE_URL}/board/${board.id}`,
      seller: { '@type': 'Person', name: hostName },
      unitCode: 'HUR',
      ...(hourlyPrice ? {
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: hourlyPrice,
          priceCurrency: 'EUR',
          unitCode: 'HUR',
          description: 'per hour rental — minimum 2 hours',
        },
      } : {}),
    },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Type', value: boardType },
      { '@type': 'PropertyValue', name: 'Longueur', value: board.length_ft ? `${board.length_ft} ft` : null },
      { '@type': 'PropertyValue', name: 'État', value: condition },
      { '@type': 'PropertyValue', name: 'Spot', value: spot },
      ...(board.spot_wave_type ? [{ '@type': 'PropertyValue', name: 'Type de vague', value: WAVE_LABELS[board.spot_wave_type] || board.spot_wave_type }] : []),
    ],
    ...(reviewCount > 0 ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: avgRating,
        reviewCount,
      }
    } : {}),
  });

  // Stars for rating display (filled + empty)
  const starsHtml = avgRating > 0
    ? '★'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating))
    : '';

  // ── Social proof badges ──────────────────────────────────────────────────────
  const isVerifiedHost = board.host_identity_status === 'verified'
    && board.host_charges_enabled
    && sanitizedPhotos.length >= 3;

  const bookings30d = parseInt(board.bookings_count_30d || 0, 10);
  const upcoming7d = parseInt(board.upcoming_bookings_7d || 0, 10);
  const listingAgeDays = parseInt(board.listing_age_days || 999, 10);
  const isNewListing = listingAgeDays <= 30;

  // ── Urgency signals (data-driven only) ──────────────────────────────────────
  // Weekend availability: only show "limited" if ≤4 free slots on Saturday or Sunday
  const weekendLimited = weekendHours
    && (weekendHours.sat_free <= 4 || weekendHours.sun_free <= 4);
  const weekendFreeTotal = weekendHours
    ? Math.min(weekendHours.sat_free, weekendHours.sun_free)
    : null;

  // ── WhatsApp CTA (only if host has a phone number stored) ───────────────────
  const hostPhone = board.host_phone
    ? String(board.host_phone).replace(/\D/g, '')
    : null;
  // Ensure French numbers start with 33 for WhatsApp
  const whatsappPhone = hostPhone
    ? (hostPhone.startsWith('33') ? hostPhone : hostPhone.startsWith('0') ? '33' + hostPhone.slice(1) : hostPhone)
    : null;
  const whatsappMsg = `Bonjour, je suis intéressé(e) par ta planche "${board.title}" sur Swell. Est-elle disponible ?`;
  const whatsappUrl = whatsappPhone
    ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMsg)}`
    : null;

  // ── Related boards carousel HTML ────────────────────────────────────────────
  function renderRelatedCard(rb) {
    const rPhotos = Array.isArray(rb.photos) ? rb.photos : (rb.photos ? JSON.parse(rb.photos) : []);
    const rPhoto = sanitizePhotoUrl(rPhotos[0]) || OG_IMAGE;
    const rPrice = rb.hourly_rate_cents
      ? `${(rb.hourly_rate_cents / 100).toFixed(0)}€<span class="rcard-unit">/h</span>`
      : rb.daily_price_cents ? `${(rb.daily_price_cents / 100).toFixed(0)}€<span class="rcard-unit">/j</span>` : '';
    const rType = BOARD_TYPE_LABELS[rb.board_type] || rb.board_type;
    const rRating = parseFloat(rb.avg_rating || 0);
    return `<a href="/board/${rb.id}" class="rcard" onclick="track('click_related_board',{board_id:${rb.id},from_board:${board.id}})">
      <div class="rcard-img" style="background-image:url('${escapeHtml(rPhoto)}')" loading="lazy"></div>
      <div class="rcard-body">
        <span class="rcard-type">${escapeHtml(rType)}</span>
        <div class="rcard-title">${escapeHtml(rb.title)}</div>
        <div class="rcard-footer">
          <span class="rcard-price">${rPrice}</span>
          ${rRating > 0 ? `<span class="rcard-rating">★ ${rRating.toFixed(1)}</span>` : ''}
        </div>
        ${rb.spot_name ? `<div class="rcard-spot">📍 ${escapeHtml(rb.spot_name)}</div>` : ''}
      </div>
    </a>`;
  }

  const relatedHtml = related.length >= 2
    ? related.slice(0, 6).map(renderRelatedCard).join('')
    : '';

  // ── Reviews HTML ────────────────────────────────────────────────────────────
  const reviewsHtml = reviews.slice(0, 5).map(r => {
    const rStars = '★'.repeat(Math.min(5, Math.max(0, Math.round(r.rating))));
    const rInitial = r.reviewer_name ? r.reviewer_name.charAt(0).toUpperCase() : '?';
    return `<div class="review-item" itemprop="review" itemscope itemtype="https://schema.org/Review">
      <div class="review-header">
        <div class="review-avatar">${r.reviewer_avatar ? `<img src="${escapeHtml(r.reviewer_avatar)}" alt="${escapeHtml(r.reviewer_name || '')}">` : rInitial}</div>
        <div>
          <div class="review-author" itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">${escapeHtml(r.reviewer_name || 'Surfeur')}</span></div>
          <div class="review-stars" itemprop="reviewRating" itemscope itemtype="https://schema.org/Rating">
            <meta itemprop="ratingValue" content="${r.rating}">${rStars}
          </div>
        </div>
      </div>
      ${r.comment ? `<div class="review-comment" itemprop="reviewBody">${escapeHtml(r.comment)}</div>` : ''}
    </div>`;
  }).join('');

  // ── Lightbox photos JSON for inline script ───────────────────────────────────
  const photosJson = JSON.stringify(sanitizedPhotos.map(p => escapeHtml(p)));

  const cspMeta = nonce
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-src 'none'; object-src 'none'; upgrade-insecure-requests;">`
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  ${cspMeta}
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${hourlyPrice}€/h à ${locationFull} | Swell</title>
  <meta name="description" content="${escapeHtml(metaDesc.substring(0, 155))}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE_URL}/board/${board.id}">
  <link rel="alternate" type="text/html" href="${BASE_URL}/board/${board.id}">

  <!-- Open Graph -->
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="Swell">
  <meta property="og:url" content="${BASE_URL}/board/${board.id}">
  <meta property="og:title" content="${title} — ${hourlyPrice}€/h à ${locationFull}">
  <meta property="og:description" content="${escapeHtml(metaDesc.substring(0, 155))}">
  <meta property="og:image" content="${escapeHtml(primaryPhoto)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${title} — ${boardType} à ${locationFull}">
  <meta property="og:locale" content="fr_FR">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title} — ${hourlyPrice}€/h à ${locationFull}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc.substring(0, 155))}">
  <meta name="twitter:image" content="${escapeHtml(primaryPhoto)}">

  <!-- JSON-LD: Schema.org Product -->
  <script type="application/ld+json">${jsonLd}</script>
  <!-- JSON-LD: BreadcrumbList -->
  <script type="application/ld+json">${breadcrumbLd}</script>

  <!-- PWA -->
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0e1e36">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --night: #0e1e36; --night-deep: #09152a; --surface: #142540;
      --card: #1a3356; --border: rgba(0,194,224,0.15);
      --primary: #00c2e0; --sunset: #ff6b35; --text: #f0f4f8;
      --text-secondary: rgba(240,244,248,0.72); --text-muted: rgba(240,244,248,0.45);
      --green: #4ade80; --green-bg: rgba(74,222,128,0.08); --green-border: rgba(74,222,128,0.3);
      --gold: #fbbf24; --radius: 16px; --radius-sm: 10px;
    }
    body { background: var(--night); color: var(--text); font-family: 'Space Grotesk', system-ui, sans-serif; line-height: 1.6; min-height: 100vh; padding-bottom: 80px; }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Nav */
    .nav { display: flex; align-items: center; justify-content: space-between; padding: 0.9rem 5%; background: rgba(14,30,54,0.95); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 200; }
    .nav-logo { font-family: 'Syne', sans-serif; font-size: 1.4rem; font-weight: 800; color: var(--text); text-decoration: none; }
    .nav-logo em { color: var(--primary); font-style: normal; }
    .nav-cta { background: var(--primary); color: var(--night-deep); padding: 0.5rem 1.2rem; border-radius: 100px; font-weight: 700; font-size: 0.85rem; text-decoration: none; }
    .nav-cta:hover { background: #00d4f5; text-decoration: none; }

    /* Breadcrumb */
    .breadcrumb { max-width: 1000px; margin: 1.5rem auto; padding: 0 1.5rem; font-size: 0.85rem; color: var(--text-muted); }
    .breadcrumb a { color: var(--primary); }

    /* Main layout */
    .container { max-width: 1000px; margin: 0 auto; padding: 0 1.5rem 4rem; }
    .board-header { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2.5rem; }

    /* Gallery + lightbox */
    .gallery { display: flex; flex-direction: column; gap: 0.75rem; position: relative; }
    .gallery-main-wrap { position: relative; cursor: zoom-in; }
    .gallery-main { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); display: block; }
    .gallery-zoom-hint { position: absolute; bottom: 0.75rem; right: 0.75rem; background: rgba(0,0,0,0.55); color: #fff; font-size: 0.72rem; padding: 0.25rem 0.6rem; border-radius: 6px; pointer-events: none; }
    .gallery-thumbs { display: flex; gap: 0.5rem; }
    .gallery-thumbs img { width: 80px; height: 60px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; transition: border-color 0.15s; }
    .gallery-thumbs img:hover, .gallery-thumbs img.active { border-color: var(--primary); }

    /* Lightbox */
    .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 900; align-items: center; justify-content: center; }
    .lightbox.open { display: flex; }
    .lightbox-img { max-width: 90vw; max-height: 88vh; object-fit: contain; border-radius: 8px; }
    .lightbox-close { position: absolute; top: 1rem; right: 1.25rem; font-size: 2rem; color: #fff; cursor: pointer; background: none; border: none; line-height: 1; }
    .lightbox-prev, .lightbox-next { position: absolute; top: 50%; transform: translateY(-50%); font-size: 2rem; color: #fff; cursor: pointer; background: rgba(0,0,0,0.4); border: none; border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; }
    .lightbox-prev { left: 1rem; }
    .lightbox-next { right: 1rem; }
    .lightbox-counter { position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,0.6); font-size: 0.85rem; }

    /* Board info */
    .board-info { display: flex; flex-direction: column; justify-content: flex-start; }
    .badges-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
    .board-type-badge { display: inline-flex; align-items: center; background: rgba(0,194,224,0.1); color: var(--primary); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 0.2rem 0.6rem; border-radius: 100px; border: 1px solid rgba(0,194,224,0.25); }
    .badge-new { display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(74,222,128,0.12); color: var(--green); font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 100px; border: 1px solid var(--green-border); }
    .badge-verified-host { display: inline-flex; align-items: center; gap: 0.3rem; background: rgba(22,163,74,0.1); color: #4ade80; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.65rem; border-radius: 100px; border: 1px solid rgba(22,163,74,0.3); cursor: help; position: relative; }
    .badge-verified-host .tooltip { display: none; position: absolute; top: 110%; left: 50%; transform: translateX(-50%); background: #1a3356; border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.9rem; font-size: 0.75rem; font-weight: 400; color: var(--text-secondary); width: 200px; z-index: 50; white-space: normal; text-align: left; }
    .badge-verified-host:hover .tooltip { display: block; }
    h1 { font-size: 1.7rem; font-weight: 800; line-height: 1.2; margin-bottom: 0.5rem; }
    .board-location { color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 0.75rem; }
    .board-meta-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .meta-item { display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; color: var(--text-secondary); }
    .meta-item strong { color: var(--text); }
    .meta-rating { color: var(--gold); }

    /* Social proof strip */
    .social-proof { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .proof-pill { display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25); border-radius: 100px; padding: 0.3rem 0.7rem; font-size: 0.78rem; color: var(--gold); font-weight: 600; }
    .proof-pill.green { background: var(--green-bg); border-color: var(--green-border); color: var(--green); }
    .proof-pill.coral { background: rgba(255,107,53,0.08); border-color: rgba(255,107,53,0.3); color: #ff8c5a; }

    /* Urgency signals */
    .urgency-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .urgency-pill { display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(255,107,53,0.08); border: 1px solid rgba(255,107,53,0.25); border-radius: 100px; padding: 0.3rem 0.75rem; font-size: 0.78rem; color: #ff8c5a; font-weight: 600; }

    .spot-tag { display: inline-flex; align-items: center; gap: 0.4rem; background: rgba(0,194,224,0.08); border: 1px solid rgba(0,194,224,0.2); border-radius: 8px; padding: 0.35rem 0.75rem; font-size: 0.82rem; font-weight: 600; margin-bottom: 1rem; }

    ${!board.host_charges_enabled ? '.payment-warning { background: rgba(255,107,53,0.12); border: 1px solid rgba(255,107,53,0.3); border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 1rem; color: #ff9a6c; font-size: 0.88rem; }' : ''}

    .price-display { font-size: 2rem; font-weight: 800; color: var(--text); margin-bottom: 1rem; }
    .price-display small { font-size: 1rem; font-weight: 500; color: var(--text-muted); }
    .book-btn { display: inline-block; background: var(--sunset); color: white; padding: 0.85rem 2rem; border-radius: 100px; font-weight: 700; font-size: 1rem; text-decoration: none; text-align: center; transition: all 0.2s; width: 100%; }
    .book-btn:hover { background: #ff7a47; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255,107,53,0.35); text-decoration: none; }
    .whatsapp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; background: rgba(37,211,102,0.1); color: #25d366; border: 1px solid rgba(37,211,102,0.35); padding: 0.65rem 1.5rem; border-radius: 100px; font-weight: 600; font-size: 0.9rem; text-decoration: none; margin-top: 0.75rem; width: 100%; transition: background 0.2s; }
    .whatsapp-btn:hover { background: rgba(37,211,102,0.18); text-decoration: none; }
    .app-link { display: block; margin-top: 0.75rem; font-size: 0.85rem; color: var(--text-muted); text-align: center; }

    /* Description + details */
    .section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; margin-bottom: 1.5rem; }
    .section h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--text); }
    .section p { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.7; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .detail-item { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 1rem; }
    .detail-item .label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 600; margin-bottom: 0.25rem; }
    .detail-item .value { font-size: 0.95rem; font-weight: 600; color: var(--text); }

    /* Host card */
    .host-card { display: flex; align-items: center; gap: 1rem; }
    .host-avatar { width: 52px; height: 52px; border-radius: 50%; background: var(--card); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 700; color: var(--primary); overflow: hidden; flex-shrink: 0; }
    .host-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .host-info { flex: 1; }
    .host-name { font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .verified-badge { display: inline-flex; align-items: center; gap: 0.2rem; font-size: 0.7rem; font-weight: 600; color: #16a34a; background: rgba(22,163,74,0.1); border: 1px solid rgba(22,163,74,0.25); border-radius: 4px; padding: 0.1rem 0.4rem; }
    .host-meta { font-size: 0.82rem; color: var(--text-muted); margin-top: 0.2rem; }

    /* Reviews */
    .reviews-section { margin-top: 0; }
    .review-item { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; margin-bottom: 0.75rem; }
    .review-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
    .review-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); overflow: hidden; }
    .review-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .review-author { font-weight: 600; font-size: 0.9rem; }
    .review-stars { color: var(--gold); font-size: 0.85rem; }
    .review-comment { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; }

    /* Related boards carousel */
    .related-section { margin-bottom: 2rem; }
    .related-section h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; color: var(--text); }
    .related-carousel { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 0.5rem; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
    .related-carousel::-webkit-scrollbar { height: 4px; }
    .related-carousel::-webkit-scrollbar-thumb { background: rgba(0,194,224,0.2); border-radius: 2px; }
    .rcard { flex: 0 0 200px; scroll-snap-align: start; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; text-decoration: none; color: var(--text); transition: transform 0.2s, border-color 0.2s; display: flex; flex-direction: column; }
    .rcard:hover { transform: translateY(-3px); border-color: rgba(0,194,224,0.35); text-decoration: none; }
    .rcard-img { width: 100%; height: 130px; background-size: cover; background-position: center; background-color: var(--card); }
    .rcard-body { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.3rem; flex: 1; }
    .rcard-type { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--primary); }
    .rcard-title { font-size: 0.85rem; font-weight: 700; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .rcard-footer { display: flex; justify-content: space-between; align-items: center; margin-top: auto; }
    .rcard-price { font-size: 1rem; font-weight: 800; }
    .rcard-unit { font-size: 0.7rem; font-weight: 500; color: var(--text-muted); }
    .rcard-rating { font-size: 0.75rem; color: var(--gold); }
    .rcard-spot { font-size: 0.72rem; color: var(--text-muted); }

    /* CTA section */
    .cta-section { background: linear-gradient(135deg, var(--sunset), #ff8c42); border-radius: var(--radius); padding: 2rem; text-align: center; color: white; }
    .cta-section h2 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    .cta-section p { font-size: 0.9rem; opacity: 0.9; margin-bottom: 1.25rem; }
    .cta-btn { display: inline-block; background: white; color: var(--sunset); padding: 0.85rem 2rem; border-radius: 100px; font-weight: 800; font-size: 1rem; text-decoration: none; }
    .cta-btn:hover { background: rgba(255,255,255,0.9); text-decoration: none; }

    /* Sticky mobile CTA bar */
    .sticky-cta { display: none; position: fixed; bottom: 0; left: 0; right: 0; background: rgba(14,30,54,0.97); backdrop-filter: blur(12px); border-top: 1px solid var(--border); padding: 0.75rem 1.25rem; z-index: 300; align-items: center; gap: 1rem; justify-content: space-between; }
    .sticky-price { font-size: 1.3rem; font-weight: 800; }
    .sticky-price small { font-size: 0.78rem; font-weight: 500; color: var(--text-muted); }
    .sticky-book { background: var(--sunset); color: white; padding: 0.7rem 1.75rem; border-radius: 100px; font-weight: 700; font-size: 0.95rem; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
    .sticky-book:hover { background: #ff7a47; text-decoration: none; }

    /* Footer */
    footer { border-top: 1px solid var(--border); padding: 2rem 5%; text-align: center; color: var(--text-muted); font-size: 0.82rem; margin-top: 2rem; }
    footer a { color: var(--text-secondary); }

    @media (max-width: 700px) {
      .board-header { grid-template-columns: 1fr; }
      h1 { font-size: 1.3rem; }
      .detail-grid { grid-template-columns: 1fr; }
      .sticky-cta { display: flex; }
      .lightbox-prev { left: 0.25rem; }
      .lightbox-next { right: 0.25rem; }
    }
    @media (min-width: 701px) {
      /* Desktop: sidebar booking is visible — stick it on scroll */
      .board-info { position: sticky; top: 70px; max-height: calc(100vh - 90px); overflow-y: auto; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-logo">Qiv<em>er</em></a>
    <a href="/app.html" class="nav-cta">🏄 Louer une planche</a>
  </nav>

  <div class="breadcrumb">
    <a href="/">Swell</a> › <a href="/app.html">Planches</a> › <a href="/spot/${encodeURIComponent(board.spot_slug || '')}">${escapeHtml(spot)}</a> › ${title}
  </div>

  <div class="container">
    <div class="board-header">
      <!-- Gallery with lightbox -->
      <div class="gallery">
        <div class="gallery-main-wrap" onclick="openLightbox(0)" id="galleryMainWrap">
          <img src="${escapeHtml(primaryPhoto)}" alt="${title} — ${boardType} à ${locationFull}" class="gallery-main" id="galleryMain" loading="eager" width="800" height="600" onerror="this.onerror=null;this.src='/og-image.svg';">
          ${sanitizedPhotos.length > 1 ? '<span class="gallery-zoom-hint">🔍 Agrandir</span>' : ''}
        </div>
        ${sanitizedPhotos.length > 1 ? `<div class="gallery-thumbs">
          ${sanitizedPhotos.slice(0, 5).map((p, i) => `<img src="${escapeHtml(p)}" alt="${title} — photo ${i + 1}" loading="lazy" class="${i === 0 ? 'active' : ''}" onclick="switchPhoto(${i})" onerror="this.onerror=null;this.src='/og-image.svg';">`).join('')}
        </div>` : ''}
      </div>

      <!-- Board info + booking widget -->
      <div class="board-info" id="bookingWidget">
        <!-- Type badge + conditional badges -->
        <div class="badges-row">
          <span class="board-type-badge">${escapeHtml(boardType)}</span>
          ${isNewListing ? '<span class="badge-new">✨ Nouveau</span>' : ''}
          ${isVerifiedHost ? `<span class="badge-verified-host">✅ Hôte vérifié
            <span class="tooltip">Identité vérifiée · Paiement Stripe activé · 3 photos minimum</span>
          </span>` : ''}
        </div>

        <h1>${title}</h1>
        <div class="board-location">📍 ${locationFull}${board.spot_name ? ` — ${escapeHtml(board.spot_name)}` : ''}</div>

        <!-- Social proof -->
        ${bookings30d > 0 || avgRating > 0 ? `<div class="social-proof">
          ${bookings30d > 0 ? `<span class="proof-pill green">🔥 Réservée ${bookings30d} fois ce mois</span>` : ''}
          ${avgRating > 0 ? `<span class="proof-pill">★ ${avgRating.toFixed(1)} <span style="font-weight:400;opacity:0.7;">(${reviewCount} avis)</span></span>` : ''}
        </div>` : ''}

        <!-- Urgency signals (real data only) -->
        ${upcoming7d > 0 || weekendLimited ? `<div class="urgency-row">
          ${upcoming7d > 0 ? `<span class="urgency-pill">⚡ ${upcoming7d} créneau${upcoming7d > 1 ? 'x' : ''} réservé${upcoming7d > 1 ? 's' : ''} cette semaine</span>` : ''}
          ${weekendLimited && weekendFreeTotal !== null && weekendFreeTotal > 0 ? `<span class="urgency-pill">🏄 Plus que ${weekendFreeTotal}h dispo ce weekend</span>` : ''}
        </div>` : ''}

        <div class="board-meta-row">
          ${board.length_ft ? `<div class="meta-item">📏 <strong>${board.length_ft} ft</strong></div>` : ''}
          <div class="meta-item">✅ <strong>${escapeHtml(condition)}</strong></div>
        </div>

        ${board.spot_wave_type ? `<div class="spot-tag">🌊 ${escapeHtml(WAVE_LABELS[board.spot_wave_type] || board.spot_wave_type)}</div>` : ''}

        ${!board.host_charges_enabled ? `<div class="payment-warning" style="background:rgba(255,107,53,0.12);border:1px solid rgba(255,107,53,0.3);border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;color:#ff9a6c;font-size:0.88rem;">
          ⚠️ Ce propriétaire n'a pas encore configuré ses paiements. Réservation temporairement indisponible.
        </div>` : ''}

        <div class="price-display">
          ${hourlyPrice}€<small>/h (min. 2h)</small>
        </div>

        ${board.host_charges_enabled
          ? `<a href="/app.html?board=${board.id}" class="book-btn" id="mainBookBtn" onclick="track('click_booking_widget',{board_id:${board.id}})">Réserver →</a>`
          : `<span class="book-btn" style="background:#4a5568;cursor:default;">Réservation indisponible</span>`
        }

        ${whatsappUrl ? `<a href="${escapeHtml(whatsappUrl)}" class="whatsapp-btn" target="_blank" rel="noopener noreferrer" onclick="track('click_whatsapp_host',{board_id:${board.id}})">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Question avant de réserver ?
        </a>` : ''}

        <a href="/app.html?board=${board.id}" class="app-link">Voir sur l'application ›</a>
      </div>
    </div>

    <!-- Description -->
    <div class="section">
      <h2>Description</h2>
      <p>${escapeHtml(board.description || `Cette planche de type ${boardType} est disponible à la location à ${locationFull}. Parfaite pour${board.skill_level === 'beginner' ? ' les débutants' : board.skill_level === 'intermediate' ? ' les surfeurs intermédiaires' : ' tous niveaux'}.`)}</p>
    </div>

    <!-- Specs -->
    <div class="section">
      <h2>Caractéristiques</h2>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">Type</div><div class="value">${escapeHtml(boardType)}</div></div>
        ${board.length_ft ? `<div class="detail-item"><div class="label">Longueur</div><div class="value">${board.length_ft} ft</div></div>` : ''}
        <div class="detail-item"><div class="label">État</div><div class="value">${escapeHtml(condition)}</div></div>
        <div class="detail-item"><div class="label">Niveau</div><div class="value">${board.skill_level === 'all' ? 'Tous niveaux' : board.skill_level === 'beginner' ? 'Débutant' : board.skill_level === 'intermediate' ? 'Intermédiaire' : 'Avancé'}</div></div>
        <div class="detail-item"><div class="label">Spot</div><div class="value">${escapeHtml(board.spot_name || board.location || 'Hossegor')}</div></div>
        ${board.fins_included ? `<div class="detail-item"><div class="label">Équipement</div><div class="value">Fins ✓</div></div>` : ''}
        ${board.leash_included ? `<div class="detail-item"><div class="label">Équipement</div><div class="value">Leash ✓</div></div>` : ''}
        <div class="detail-item"><div class="label">Prix / h</div><div class="value">${hourlyPrice}€ (min. 2h)</div></div>
      </div>
    </div>

    <!-- Host -->
    <div class="section">
      <h2>Votre hôte</h2>
      <div class="host-card">
        <div class="host-avatar">${board.host_avatar ? `<img src="${escapeHtml(board.host_avatar)}" alt="${escapeHtml(hostName)}" loading="lazy">` : escapeHtml(hostName.charAt(0).toUpperCase())}</div>
        <div class="host-info">
          <div class="host-name">
            ${escapeHtml(hostName)}
            ${board.host_identity_status === 'verified' ? '<span class="verified-badge">✅ Vérifié</span>' : ''}
            ${board.host_charges_enabled ? '<span class="verified-badge" style="color:#60a5fa;border-color:rgba(96,165,250,0.3);background:rgba(96,165,250,0.08);">💳 Paiement OK</span>' : ''}
          </div>
          ${board.host_bio ? `<div class="host-meta">${escapeHtml(board.host_bio.substring(0, 100))}${board.host_bio.length > 100 ? '…' : ''}</div>` : ''}
          ${board.host_location ? `<div class="host-meta">📍 ${escapeHtml(board.host_location)}</div>` : ''}
          ${board.total_completed_bookings > 0 ? `<div class="host-meta">🏄 ${board.total_completed_bookings} session${board.total_completed_bookings > 1 ? 's' : ''} complétée${board.total_completed_bookings > 1 ? 's' : ''}</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Reviews (only when they exist) -->
    ${reviewCount > 0 ? `<div class="section reviews-section" itemscope itemtype="https://schema.org/Product">
      <h2>⭐ Avis (${reviewCount})</h2>
      ${reviewsHtml}
    </div>` : ''}

    <!-- Related boards carousel (only when ≥2 results) -->
    ${relatedHtml ? `<div class="related-section">
      <h2>Autres boards à ${escapeHtml(board.spot_name || spot)}</h2>
      <div class="related-carousel">${relatedHtml}</div>
    </div>` : ''}

    <div class="cta-section">
      <h2>Tu veux cette planche pour ta session ?</h2>
      <p>Réserve directement sur Swell — transfert sécurisé, assurance incluse.</p>
      <a href="/app.html?board=${board.id}" class="cta-btn" onclick="track('click_booking_widget',{board_id:${board.id},source:'cta_bottom'})">Réserver maintenant →</a>
    </div>
  </div>

  <!-- Sticky mobile CTA bar -->
  <div class="sticky-cta" id="stickyCta">
    <div>
      <div class="sticky-price">${hourlyPrice}€<small>/h</small></div>
    </div>
    <a href="/app.html?board=${board.id}" class="sticky-book" onclick="track('click_booking_widget',{board_id:${board.id},source:'sticky_mobile'})">Réserver →</a>
  </div>

  <!-- Lightbox overlay -->
  <div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Galerie photos">
    <button class="lightbox-close" onclick="closeLightbox()" aria-label="Fermer">✕</button>
    <button class="lightbox-prev" onclick="lightboxNav(-1)" aria-label="Photo précédente">‹</button>
    <img class="lightbox-img" id="lightboxImg" src="" alt="${title}">
    <button class="lightbox-next" onclick="lightboxNav(1)" aria-label="Photo suivante">›</button>
    <div class="lightbox-counter" id="lightboxCounter"></div>
  </div>

  <footer>
    <a href="/">Swell</a> · <a href="/app.html">Planches</a> · <a href="/blog">Blog</a> · <a href="/cgv">CGV</a> · <a href="/confidentialite">Confidentialité</a>
    <br><br>
    © 2026 Swell — Location de planches entre surfeurs. Hossegor, Seignosse, Capbreton.
  </footer>

  <script nonce="${nonce || ''}">
    // ── Analytics (fire-and-forget, no auth needed) ──────────────────────────
    function track(event, props) {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...props })
      }).catch(() => {});
    }

    // ── Pageview on load ─────────────────────────────────────────────────────
    track('board_view', { board_id: ${board.id}, spot: ${JSON.stringify(spot)} });

    // ── Photo gallery with lightbox ──────────────────────────────────────────
    const PHOTOS = ${photosJson};
    let currentPhoto = 0;

    function switchPhoto(idx) {
      currentPhoto = idx;
      const main = document.getElementById('galleryMain');
      if (main && PHOTOS[idx]) {
        main.src = PHOTOS[idx];
        document.querySelectorAll('.gallery-thumbs img').forEach((el, i) => {
          el.classList.toggle('active', i === idx);
        });
      }
    }

    function openLightbox(idx) {
      if (PHOTOS.length === 0) return;
      currentPhoto = idx;
      const lb = document.getElementById('lightbox');
      const img = document.getElementById('lightboxImg');
      const counter = document.getElementById('lightboxCounter');
      img.src = PHOTOS[idx];
      counter.textContent = (idx + 1) + ' / ' + PHOTOS.length;
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('open');
      document.body.style.overflow = '';
    }

    function lightboxNav(dir) {
      currentPhoto = (currentPhoto + dir + PHOTOS.length) % PHOTOS.length;
      openLightbox(currentPhoto);
    }

    // Keyboard navigation + swipe support in lightbox
    document.addEventListener('keydown', function(e) {
      const lb = document.getElementById('lightbox');
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') lightboxNav(-1);
      else if (e.key === 'ArrowRight') lightboxNav(1);
    });

    // Touch swipe for lightbox
    let touchStartX = 0;
    document.getElementById('lightbox').addEventListener('touchstart', function(e) {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    document.getElementById('lightbox').addEventListener('touchend', function(e) {
      const diff = touchStartX - e.changedTouches[0].screenX;
      if (Math.abs(diff) > 50) lightboxNav(diff > 0 ? 1 : -1);
    }, { passive: true });

    // ── Desktop sticky sidebar — hide sticky mobile bar on desktop ───────────
    // The sticky mobile bar is CSS-hidden above 700px, so this is just a safety valve.
    // On desktop, the .board-info sidebar is sticky via CSS position:sticky.

    // ── replaceState to canonical /boards/:id ─────────────────────────────────
    if (window.location.pathname !== '/board/${board.id}') {
      try { history.replaceState(null, '', '/board/${board.id}'); } catch(e) {}
    }
  </script>
</body>
</html>`;
}

// ─── Blog article redirects (301) — .html → clean slug ──────────────────────
// Search engines prefer no extension. Old .html links get a permanent redirect.
const BLOG_ARTICLE_SLUGS = {
  '10-vagues-hossegor':            '/blog/10-vagues-hossegor.html',
  'emprunter-planche-vendee':      '/blog/emprunter-planche-vendee.html',
  'location-surfboard-particuliers': '/blog/location-surfboard-particuliers.html',
};

router.get('/blog/:slug', (req, res) => {
  const target = BLOG_ARTICLE_SLUGS[req.params.slug];
  if (target) return res.redirect(301, target);
  res.status(404).send('Article non trouvé');
});

// ─── Routes ────────────────────────────────────────────────────────────────

// Board detail page — SSR with dynamic meta tags for Google indexing
// Fetches reviews, related boards, and weekend availability in parallel.
router.get('/board/:id', async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!boardId || isNaN(boardId)) return res.status(404).send('Page non trouvée');

    const board = await getBoardById(boardId);
    if (!board || !board.is_listed) return res.status(404).send('Page non trouvée');

    // Fetch supplementary data in parallel — failures are non-fatal
    const [reviews, related, weekendHours] = await Promise.all([
      getReviewsForBoard(boardId).catch(() => []),
      getRelatedBoards(boardId, board.spot_id, board.spot_lat, board.spot_lng, board.board_type, 6).catch(() => []),
      getWeekendAvailableHours(boardId).catch(() => null),
    ]);

    const html = await renderBoardDetailPage(board, res.locals.cspNonce, reviews, related, weekendHours);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(html);
  } catch (err) {
    console.error('GET /board/:id error:', err);
    res.status(500).send('Erreur serveur — réessayez plus tard.');
  }
});

// Dynamic sitemap — pages, spots from DB, boards, blogs
router.get('/sitemap.xml', async (req, res) => {
  try {
    const [boards, spots] = await Promise.all([
      listBoards({ limit: 1000, offset: 0 }),
      listSpots(),
    ]);
    const now = new Date().toISOString().split('T')[0];

    // Core pages
    const staticUrls = [
      { loc: `${BASE_URL}/`, lastmod: now, priority: '1.0', changefreq: 'weekly' },
      { loc: `${BASE_URL}/app.html`, lastmod: now, priority: '0.9', changefreq: 'daily' },
      { loc: `${BASE_URL}/listings`, lastmod: now, priority: '0.8', changefreq: 'hourly' },
      { loc: `${BASE_URL}/map`, lastmod: now, priority: '0.8', changefreq: 'daily' },
      { loc: `${BASE_URL}/host.html`, lastmod: now, priority: '0.6', changefreq: 'monthly' },
      { loc: `${BASE_URL}/partner.html`, lastmod: now, priority: '0.5', changefreq: 'monthly' },
      { loc: `${BASE_URL}/cgv.html`, lastmod: now, priority: '0.3', changefreq: 'yearly' },
      { loc: `${BASE_URL}/confidentialite.html`, lastmod: now, priority: '0.3', changefreq: 'yearly' },
      { loc: `${BASE_URL}/mentions-legales.html`, lastmod: now, priority: '0.3', changefreq: 'yearly' },
    ];

    // Spot pages — dynamic from DB. Priority 0.8 per SEO spec (task #2037154).
    const spotUrls = spots
      .filter(s => s.slug)
      .map(s => ({
        loc: `${BASE_URL}/spot/${s.slug}`,
        lastmod: now,
        priority: '0.8',
        changefreq: 'weekly',
      }));

    // Blog index + articles
    const blogUrls = [
      { loc: `${BASE_URL}/blog`, lastmod: now, priority: '0.7', changefreq: 'weekly' },
      { loc: `${BASE_URL}/blog/10-vagues-hossegor`, lastmod: '2026-05-14', priority: '0.7', changefreq: 'monthly' },
      { loc: `${BASE_URL}/blog/emprunter-planche-vendee`, lastmod: '2026-05-14', priority: '0.7', changefreq: 'monthly' },
      { loc: `${BASE_URL}/blog/location-surfboard-particuliers`, lastmod: '2026-05-14', priority: '0.7', changefreq: 'monthly' },
    ];

    // Only index boards with Stripe-enabled hosts — unboookable boards have no value in search.
    // host_charges_enabled is aliased as stripe_charges_enabled in listBoards JOIN.
    const boardUrls = boards
      .filter(b => b.host_charges_enabled)
      .map(b => ({
        loc: `${BASE_URL}/board/${b.id}`,
        lastmod: b.updated_at ? new Date(b.updated_at).toISOString().split('T')[0] : now,
        priority: '0.7',
        changefreq: 'weekly',
      }));

    const allUrls = [...staticUrls, ...spotUrls, ...blogUrls, ...boardUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.header('Cache-Control', 'public, max-age=21600');
    res.send(xml);
  } catch (err) {
    console.error('sitemap error:', err);
    res.status(500).type('text').send('Sitemap temporarily unavailable');
  }
});

// JSON-LD structured data for a specific board listing (Product schema)
// Used by the SPA to inject into <head> for board detail views
router.get('/structured-data/board/:id', async (req, res) => {
  try {
    const board = await getBoardById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    const hourlyPrice = board.hourly_rate_cents
      ? (board.hourly_rate_cents / 100).toFixed(2)
      : board.daily_price_cents ? (board.daily_price_cents / 800).toFixed(2) : null;
    const photos = Array.isArray(board.photos) ? board.photos : (board.photos ? JSON.parse(board.photos) : []);
    const primaryImage = sanitizePhotoUrl(photos[0] || OG_IMAGE);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: board.title,
      description: board.description || `${board.board_type} surfboard for rent in ${board.location}`,
      image: photos.length > 0 ? photos.map(sanitizePhotoUrl) : [primaryImage],
      brand: {
        '@type': 'Brand',
        name: 'Swell',
      },
      offers: {
        '@type': 'Offer',
        priceCurrency: 'EUR',
        price: hourlyPrice,
        priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        availability: board.is_available
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        url: `${BASE_URL}/board/${board.id}`,
        seller: {
          '@type': 'Person',
          name: board.host_name,
        },
        unitCode: 'HUR',
        ...(hourlyPrice ? {
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: hourlyPrice,
            priceCurrency: 'EUR',
            unitCode: 'HUR',
            description: 'per hour rental — minimum 2 hours',
          },
        } : {}),
      },
      additionalProperty: [
        { '@type': 'PropertyValue', name: 'Board Type', value: board.board_type },
        { '@type': 'PropertyValue', name: 'Length', value: `${board.length_ft} ft` },
        { '@type': 'PropertyValue', name: 'Condition', value: board.condition },
        { '@type': 'PropertyValue', name: 'Location', value: board.location },
      ],
      ...(board.review_count > 0 ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: parseFloat(board.avg_rating),
          reviewCount: parseInt(board.review_count, 10),
        }
      } : {}),
    };

    res.json(jsonLd);
  } catch (err) {
    console.error('structured-data error:', err);
    res.status(500).json({ error: 'Could not fetch structured data' });
  }
});

module.exports = router;
