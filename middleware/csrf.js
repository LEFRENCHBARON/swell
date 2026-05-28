// CSRF protection — double-submit cookie pattern.
// Owns: token generation, cookie setting, header validation on state-changing methods.
// Does NOT own: session management, auth, route logic.
const crypto = require('crypto');

const TOKEN_LENGTH = 32; // 256 bits
const COOKIE_NAME = 'XSRF-TOKEN';
const HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Generates/refreshes the CSRF token stored in the session and mirrors it
 * to a non-httpOnly cookie so the frontend JS can read it and attach it as
 * a custom header on mutating requests.
 *
 * Flow:
 *  1. Ensure session has a csrfToken (create one if missing).
 *  2. Set XSRF-TOKEN cookie (JS-readable) on every response so the frontend
 *     always has a fresh copy.
 *  3. On POST/PUT/PATCH/DELETE, compare the X-CSRF-Token header value against
 *     the session token. Reject on mismatch (403).
 */
function csrfProtection(req, res, next) {
  // Ensure token exists in session
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(TOKEN_LENGTH).toString('hex');
  }

  // Mirror token to a JS-readable cookie on every response so the SPA can
  // read it even after session token rotation.
  res.cookie(COOKIE_NAME, req.session.csrfToken, {
    httpOnly: false, // JS must read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
  });

  // Safe methods — no validation needed
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Validate: compare header value to session value
  const headerToken = req.headers[HEADER_NAME];
  if (!headerToken || headerToken !== req.session.csrfToken) {
    return res.status(403).json({ error: 'CSRF token invalide ou manquant.' });
  }

  next();
}

module.exports = csrfProtection;
