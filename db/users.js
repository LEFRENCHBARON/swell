// What this module owns: user auth and profile queries.
// Does NOT handle sessions, HTTP, or authorization logic.
const pool = require('./index');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

// Legacy SHA-256 hash — used only during migration from the original insecure scheme
function legacyHash(password) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(password + 'swell_salt_2026').digest('hex');
}

// PBKDF2 hash — second-generation scheme, also being migrated to bcrypt
function pbkdf2Hash(password, salt) {
  const crypto = require('crypto');
  return crypto.pbkdf2Sync(password, salt, 600000, 64, 'sha512');
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function createUser({ email, name, password }) {
  const hash = await hashPassword(password);
  const result = await pool.query(`
    INSERT INTO users (email, name, password_hash, password_needs_rehash)
    VALUES ($1, $2, $3, false)
    RETURNING id, email, name, is_host, avatar_url, bio, surf_level, location, created_at
  `, [email.toLowerCase(), name, hash]);
  return result.rows[0];
}

async function getUserByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0] || null;
}

async function getUserById(id) {
  const result = await pool.query(
    'SELECT id, email, name, is_host, avatar_url, bio, surf_level, location, host_since, best_surf_trip_text, email_verified, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function verifyPassword(email, password) {
  const user = await getUserByEmail(email);
  if (!user) return null;

  let valid = false;

  if (user.password_hash.startsWith('$2')) {
    // bcrypt hash — verify and done
    valid = await bcrypt.compare(password, user.password_hash);
  } else if (user.password_hash.includes(':') && user.password_hash.split(':').length === 2) {
    // PBKDF2 hash (second-gen) — verify, then upgrade to bcrypt
    const [saltB64, storedHashB64] = user.password_hash.split(':');
    try {
      const salt = Buffer.from(saltB64, 'base64');
      const computed = pbkdf2Hash(password, salt);
      valid = computed.toString('base64') === storedHashB64;
      if (valid) {
        const newHash = await hashPassword(password);
        await pool.query(
          'UPDATE users SET password_hash = $1 WHERE id = $2',
          [newHash, user.id]
        );
      }
    } catch (e) {
      valid = false;
    }
  } else if (user.password_needs_rehash) {
    // SHA-256 hash (first-gen) — verify, then upgrade to bcrypt
    if (user.password_hash === legacyHash(password)) {
      const newHash = await hashPassword(password);
      await pool.query(
        'UPDATE users SET password_hash = $1, password_needs_rehash = false WHERE id = $2',
        [newHash, user.id]
      );
      valid = true;
    }
  }

  if (!valid) return null;
  return { id: user.id, email: user.email, name: user.name, is_host: user.is_host, avatar_url: user.avatar_url };
}

async function updateProfile(id, fields) {
  const allowed = ['name', 'bio', 'avatar_url', 'surf_level', 'location', 'best_surf_trip_text'];
  const updates = [];
  const params = [id];

  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      params.push(val);
      updates.push(`${key} = $${params.length}`);
    }
  }

  if (updates.length === 0) return null;
  updates.push(`updated_at = NOW()`);

  const result = await pool.query(`
    UPDATE users SET ${updates.join(', ')}
    WHERE id = $1
    RETURNING id, email, name, is_host, avatar_url, bio, surf_level, location, host_since, best_surf_trip_text
  `, params);
  return result.rows[0] || null;
}

async function becomeHost(userId) {
  const result = await pool.query(`
    UPDATE users SET is_host = true, host_since = NOW(), updated_at = NOW()
    WHERE id = $1
    RETURNING id, is_host, host_since
  `, [userId]);
  return result.rows[0] || null;
}

async function getPublicProfile(userId) {
  const result = await pool.query(`
    SELECT
      u.id, u.name, u.bio, u.avatar_url, u.surf_level, u.location, u.is_host, u.host_since,
      u.best_surf_trip_text, u.created_at, u.identity_status, u.stripe_charges_enabled,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count,
      COUNT(DISTINCT b.id) AS board_count,
      COUNT(DISTINCT bk.id) FILTER (WHERE bk.status = 'completed') AS total_completed_rentals
    FROM users u
    LEFT JOIN reviews r ON r.reviewee_id = u.id AND r.published_at IS NOT NULL
    LEFT JOIN boards b ON b.host_id = u.id
    LEFT JOIN bookings bk ON bk.board_id = b.id
    WHERE u.id = $1
    GROUP BY u.id
  `, [userId]);
  return result.rows[0] || null;
}

// Submit identity documents (front + back) for manual review
async function submitIdentityDoc(userId, docFrontUrl, docBackUrl) {
  const result = await pool.query(`
    UPDATE users
    SET identity_status = 'pending_review',
        identity_doc_url = $2,
        identity_doc_back_url = $3,
        identity_submitted_at = NOW(),
        identity_provider = 'swell_manual',
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, identity_status, identity_submitted_at
  `, [userId, docFrontUrl, docBackUrl]);
  return result.rows[0] || null;
}

// Admin: approve identity verification
async function approveIdentity(userId) {
  const result = await pool.query(`
    UPDATE users
    SET identity_status = 'verified',
        identity_verified_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, identity_status, identity_verified_at
  `, [userId]);
  return result.rows[0] || null;
}

// Admin: reject identity — user can retry (clears both document sides)
async function rejectIdentity(userId) {
  const result = await pool.query(`
    UPDATE users
    SET identity_status = 'rejected',
        identity_doc_url = NULL,
        identity_doc_back_url = NULL,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, identity_status
  `, [userId]);
  return result.rows[0] || null;
}

// Get identity status for a user (auth check)
async function getIdentityStatus(userId) {
  const result = await pool.query(`
    SELECT id, identity_status, identity_submitted_at, identity_verified_at, identity_doc_url, identity_doc_back_url
    FROM users WHERE id = $1
  `, [userId]);
  return result.rows[0] || null;
}

// Admin: get all hosts (users with ≥1 board listed)
async function getAllHosts() {
  const result = await pool.query(`
    SELECT u.id, u.name, u.email, u.is_host
    FROM users u
    WHERE EXISTS (SELECT 1 FROM boards b WHERE b.host_id = u.id)
      AND u.email IS NOT NULL
      AND u.email != ''
      AND u.id != 9
    ORDER BY u.created_at
  `);
  return result.rows;
}

// Admin: get all renters (users with no boards listed)
async function getAllRenters() {
  const result = await pool.query(`
    SELECT u.id, u.name, u.email, u.is_host
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM boards b WHERE b.host_id = u.id)
      AND u.email IS NOT NULL
      AND u.email != ''
      AND u.id != 9
    ORDER BY u.created_at
  `);
  return result.rows;
}

// Admin: get hosts who have not configured Stripe (charges not enabled)
async function getHostsWithoutStripe() {
  const result = await pool.query(`
    SELECT u.id, u.name, u.email, u.stripe_charges_enabled, u.stripe_onboarding_completed_at,
           COUNT(b.id)::INT AS board_count
    FROM users u
    JOIN boards b ON b.host_id = u.id
    WHERE u.stripe_charges_enabled = false
      AND u.email IS NOT NULL
      AND u.email != ''
      AND u.id != 9
    GROUP BY u.id
    ORDER BY u.created_at
  `);
  return result.rows;
}

// Returns signed-up users who have never made a booking and haven't received
// the activation_2026_05 campaign email. Ordered by fewest bookings first (oldest
// signups with zero activity get priority).
async function getActivationTargets(poolOrClient) {
  const result = await poolOrClient.query(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.created_at,
      u.location,
      COUNT(bk.id)::INT AS booking_count
    FROM users u
    LEFT JOIN bookings bk ON bk.renter_id = u.id
    WHERE u.email IS NOT NULL
      AND u.email != ''
      AND u.email NOT ILIKE '%@polsia.app'
      AND u.email NOT ILIKE '%@mailinator.com'
      AND u.id != 9
      AND (u.name IS NULL OR (u.name NOT ILIKE 'Test%' AND u.name NOT ILIKE 'QA%' AND u.name NOT ILIKE '%Test Rider%' AND u.name NOT ILIKE '%Test Host%' AND u.name NOT ILIKE '%Test Owner%' AND u.name NOT ILIKE '%Test Propri%'))
      AND NOT EXISTS (
        SELECT 1 FROM email_sends es
        WHERE es.user_id = u.id AND es.campaign = 'activation_2026_05'
      )
    GROUP BY u.id
    ORDER BY booking_count ASC, u.created_at ASC
    LIMIT 14
  `);
  return result.rows;
}

// Returns up to 3 available boards, ordered by verified host first, then cheapest.
// Uses location or falls back to Hossegor/Biarritz region.
async function getBoardsNearLocation(poolOrClient, location, limit = 3) {
  const regionFilter = location && location.trim()
    ? `%${location.trim()}%`
    : '%Hossegor%';

  const result = await poolOrClient.query(`
    SELECT
      b.id,
      b.title,
      b.board_type,
      b.hourly_rate_cents,
      b.photos,
      b.location,
      u.stripe_charges_enabled AS verified_host
    FROM boards b
    JOIN users u ON u.id = b.host_id
    WHERE b.is_available = true
      AND b.is_listed = true
      AND (
        b.location ILIKE $1
        OR b.region ILIKE $1
        OR b.location ILIKE '%Hossegor%'
        OR b.location ILIKE '%Biarritz%'
      )
    ORDER BY u.stripe_charges_enabled DESC NULLS LAST, b.hourly_rate_cents ASC NULLS LAST
    LIMIT $2
  `, [regionFilter, limit]);
  return result.rows;
}

// Log a sent activation email — idempotent via ON CONFLICT.
async function logActivationEmail(poolOrClient, userId, email, version = 'v1') {
  await poolOrClient.query(`
    INSERT INTO email_sends (user_id, email, campaign, template_version)
    VALUES ($1, $2, 'activation_2026_05', $3)
    ON CONFLICT (user_id, campaign) DO NOTHING
  `, [userId, email, version]);
}

// Returns hosts with 0 confirmed bookings — dormant supply for activation campaigns.
// Excludes the test bot (id=9) and users with no email.
async function getDormantHosts() {
  const result = await pool.query(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.avatar_url AS host_avatar,
      u.stripe_charges_enabled AS host_charges_enabled,
      u.created_at AS member_since,
      b.id AS board_id,
      b.title AS board_title,
      b.board_type,
      b.hourly_rate_cents,
      b.photos,
      s.name AS spot_name
    FROM users u
    JOIN boards b ON b.host_id = u.id
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    WHERE u.id != 9
      AND u.email IS NOT NULL
      AND u.email != ''
      AND NOT EXISTS (
        SELECT 1 FROM bookings bk
        WHERE bk.board_id = b.id AND bk.status = 'completed'
      )
    ORDER BY u.created_at ASC
  `);
  return result.rows;
}

// Generate a secure random token for email verification
function generateEmailVerificationToken() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Set email verification token on a user — call on signup and resend.
// Stores token + 24h expiry window.
async function setEmailVerificationToken(userId) {
  const token = generateEmailVerificationToken();
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS).toISOString();
  await pool.query(
    `UPDATE users SET email_verification_token = $1, email_token_expires_at = $2 WHERE id = $3`,
    [token, expiresAt, userId]
  );
  return token;
}

// Verify email from token — sets email_verified = true, clears token + expiry.
// Only succeeds if token matches AND hasn't expired.
async function verifyEmail(token) {
  if (!token) return null;
  const result = await pool.query(
    `UPDATE users
     SET email_verified = true,
         email_verification_token = NULL,
         email_token_expires_at = NULL
     WHERE email_verification_token = $1
       AND email_verified = false
       AND (email_token_expires_at IS NULL OR email_token_expires_at > NOW())
     RETURNING id, email, name, email_verified`,
    [token.trim()]
  );
  return result.rows[0] || null;
}

// Check if a user has verified their email (polling gate for publish/reserve).
async function isEmailVerified(userId) {
  const result = await pool.query(
    `SELECT email_verified FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0]?.email_verified || false;
}

// Rate-limit check: was the last token sent less than 1 minute ago?
async function getEmailTokenAge(userId) {
  const result = await pool.query(
    `SELECT email_token_expires_at FROM users WHERE id = $1`,
    [userId]
  );
  if (!result.rows[0]?.email_token_expires_at) return Infinity; // no token = ok
  return Date.now() - new Date(result.rows[0].email_token_expires_at).getTime() + EMAIL_TOKEN_TTL_MS;
}

module.exports = { createUser, getUserByEmail, getUserById, verifyPassword, updateProfile, becomeHost, getPublicProfile, submitIdentityDoc, approveIdentity, rejectIdentity, getIdentityStatus, getAllHosts, getAllRenters, getHostsWithoutStripe, getDormantHosts, getActivationTargets, getBoardsNearLocation, logActivationEmail, setEmailVerificationToken, verifyEmail, isEmailVerified, getEmailTokenAge };
