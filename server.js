// Entry point: wiring only — middleware, route mounts, app.listen.
// No business logic, no queries, no route handlers live here.
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db/index');
const csrfProtection = require('./middleware/csrf');
const logger = require('./lib/logger');
const { authLimiter, apiLimiter, promoLimiter } = require('./lib/rateLimits');

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  logger.fatal({ env: 'DATABASE_URL' }, 'Missing required environment variable');
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  logger.fatal({ env: 'SESSION_SECRET' }, 'Missing required environment variable');
  process.exit(1);
}

if (!process.env.ADMIN_SECRET) {
  logger.fatal({ env: 'ADMIN_SECRET' }, 'Missing required environment variable');
  process.exit(1);
}

if (!process.env.IBAN_ENCRYPTION_KEY) {
  logger.fatal({ env: 'IBAN_ENCRYPTION_KEY' }, 'IBAN_ENCRYPTION_KEY env var is required for secure IBAN storage');
  process.exit(1);
}

// Redirect session.surf → swell.polsia.app (301) to consolidate duplicate
// content. All canonical tags, OG URLs, and sitemap entries point to
// swell.polsia.app; session.surf must not be indexed separately.
const CANONICAL_HOST = 'swell.polsia.app';
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.hostname === 'session.surf') {
      const target = `https://${CANONICAL_HOST}${req.originalUrl}`;
      return res.redirect(301, target);
    }
    next();
  });
}

// Render terminates TLS at the load balancer — without this, Express
// sees HTTP and refuses to set Secure session cookies in production.
app.set('trust proxy', 1);

// Gzip compression for all responses — significant improvement for HTML/CSS/JSON
app.use(compression());

// CSP nonce — random per request, injected into inline scripts
const crypto = require('crypto');
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Security headers — strict CSP; unsafe-inline required for spot-pages.js/seo.js inline styles
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],   // unsafe-inline required for inline styles in spot-pages.js, seo.js
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require('cookie-parser'));

// Session store backed by Postgres
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'swell_sid',
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'  // First-line CSRF defense — blocks cross-origin POST with cookies
  }
}));

// /app.html — nonce-injected, CSP without 'unsafe-inline' for script-src
// Extracted to routes/app-html.js to keep server.js under 300 lines.
app.use(require('./routes/app-html'));

// /listings — server-rendered board listing (before static, takes priority over app.html fallback)
app.use('/listings', require('./routes/listings'));

// Static files with long-lived cache for assets (images, fonts, css, js)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  // HTML files intentionally excluded from long cache (served via explicit routes)
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    // Service workers: never cache — must always run fresh code
    if (filePath.endsWith('sw.js') || filePath.endsWith('sw-v3.js')) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
    // CSP for static HTML pages (other than app.html, which is served by routes/app-html.js
    // with per-request nonce injection and strict script-src without unsafe-inline).
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: blob:",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "upgrade-insecure-requests",
      ].join('; '));
    }
  },
}));

// Health check (required for Render — no DB query)
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// CSRF protection — validates X-CSRF-Token header on POST/PUT/PATCH/DELETE.
// Mounted on /api/* only; static pages and server-rendered routes are exempt.
app.use('/api', csrfProtection);

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/boards', require('./routes/boards'));
app.use('/api/spots', require('./routes/spots'));
app.use('/api/bookings', apiLimiter, require('./routes/bookings'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/profiles', require('./routes/profiles'));
app.use('/api/partners', require('./routes/partners'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/reviews', apiLimiter, require('./routes/reviews'));
app.use('/api/identity', require('./routes/identity'));
app.use('/api/stripe-connect', require('./routes/stripe-connect'));
app.use('/api/genome', require('./routes/genome'));
app.use('/api/intelligence', require('./routes/intelligence'));
app.use('/api/promo', promoLimiter, require('./routes/promo'));
app.use('/api/deposits', apiLimiter, require('./routes/deposits'));
app.use('/api/inspections', apiLimiter, require('./routes/inspections'));
app.use('/api/host-metrics', require('./routes/hostMetrics'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/activation', require('./routes/activation'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/track', require('./routes/track'));
app.use('/api/consent', require('./routes/consent'));
app.use('/api/search', require('./routes/search'));
app.use('/spots', require('./routes/spot-landing'));
app.use('/spot', require('./routes/spot-pages'));
app.use('/map', require('./routes/map'));
app.use('/api/map', require('./routes/map'));
// /boards/:id — canonical board detail URL; SPA reads ?board= and opens modal
app.get('/boards/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).redirect('/app.html');
  res.setHeader('Cache-Control', 'no-cache');
  res.redirect(302, `/app.html?board=${id}`);
});

app.use('/', require('./routes/seo'));

// Blog routing
app.get('/blog', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blog', 'index.html'));
});

// Blog routing — also handles .html extension from sitemap (/blog/10-vagues-hossegor.html)
app.get('/blog/:slug', (req, res) => {
  let slug = req.params.slug;
  // Strip .html if already in slug — handles sitemap URLs that include .html
  if (slug.endsWith('.html')) slug = slug.slice(0, -5);
  const filePath = path.join(__dirname, 'public', 'blog', `${slug}.html`);
  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(filePath);
  } else {
    res.status(404).redirect('/blog');
  }
});

// Brand Lab — internal design preview; gated by BRAND_LAB_KEY env var (default: 'swell-lab').
// Never indexed (noindex meta in HTML). Access via /brand-lab?key=swell-lab
app.get('/brand-lab', (req, res) => {
  if (req.query.key !== (process.env.BRAND_LAB_KEY || 'swell-lab'))
    return res.status(401).send('Accès restreint — ajoute ?key=... à l\'URL.');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'brand-lab.html'));
});

// Partner landing page
app.get('/partner', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'partner.html'));
});

// Press kit — public, no auth
app.get('/press', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'press.html'));
});

// Host hub — dashboard for board owners
app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// Host activation checklist — Verified Host progress page
app.get('/host/activation', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'host-activation.html'));
});

// Legal pages
app.get('/cgv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cgv.html'));
});
app.get('/cgu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cgv.html'));
});
app.get('/confidentialite', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confidentialite.html'));
});
app.get('/mentions-legales', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mentions-legales.html'));
});

// Payment success page — Stripe redirects here after checkout
app.get('/payment/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-success.html'));
});

// Payment cancel page — Stripe redirects here when user cancels checkout
app.get('/payment/cancel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-cancel.html'));
});

// Unsubscribe page — GDPR-required; referenced in all transactional emails
app.get('/unsubscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'unsubscribe.html'));
});

// Review page — pre-fills rating from ?booking=ID&rating=N (linked from T+24h post-session email)
app.get('/review', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// Landing page with analytics slug injection
app.get('/', (req, res) => {
  const slug = process.env.POLSIA_ANALYTICS_SLUG || '';
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('__POLSIA_SLUG__', slug);
    res.type('html').send(html);
  } else {
    res.redirect('/app.html');
  }
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException — process will exit');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason: String(reason) }, 'unhandledRejection — process will exit');
  process.exit(1);
});

app.listen(port, '0.0.0.0', () => {
  logger.info({ port, env: process.env.NODE_ENV || 'development' }, 'Swell server started');
});
