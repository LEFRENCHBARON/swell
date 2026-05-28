// Rate limiter configurations. Middleware imports these in server.js.
// Does NOT own route mounting — that's server.js's job.
const rateLimit = require('express-rate-limit');

// Auth limiter — 20 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives — réessayez dans 15 minutes.' },
});

// General API limiter — 30 req/min
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes — ralentissez et réessayez.' },
});

// Promo limiter — 10 attempts/min to slow discount code enumeration
const promoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives — réessayez dans 1 minute.' },
});

module.exports = { authLimiter, apiLimiter, promoLimiter };