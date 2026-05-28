// What this module owns: all database queries for the boards table.
// Does NOT handle HTTP, authentication, or business logic.
const pool = require('./index');

async function listBoards({ region, boardType, minPrice, maxPrice, skillLevel, spotId, spotLat, spotLng, limit = 20, offset = 0 }) {
  // is_listed = false means host has delisted the board — never show to renters.
  const conditions = ['b.is_listed = true'];
  const params = [];

  if (region) {
    params.push(region.toLowerCase());
    conditions.push(`b.region = $${params.length}`);
  }
  if (boardType) {
    params.push(boardType);
    conditions.push(`b.board_type = $${params.length}`);
  }
  if (minPrice != null) {
    params.push(minPrice * 100);
    conditions.push(`b.daily_price_cents >= $${params.length}`);
  }
  if (maxPrice != null) {
    params.push(maxPrice * 100);
    conditions.push(`b.daily_price_cents <= $${params.length}`);
  }
  if (skillLevel) {
    params.push(skillLevel);
    conditions.push(`(b.skill_level = $${params.length} OR b.skill_level = 'all')`);
  }
  if (spotId) {
    params.push(spotId);
    conditions.push(`b.spot_id = $${params.length}`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // When a spot coordinate is provided, order by distance to that spot.
  // Distance is Euclidean (fine for short coastal ranges, avoids PostGIS dependency).
  let distanceSelect = '';
  let orderBy = 'ORDER BY b.created_at DESC';
  if (spotLat != null && spotLng != null) {
    params.push(spotLat, spotLng);
    const latIdx = params.length - 1;
    const lngIdx = params.length;
    distanceSelect = `,
      CASE
        WHEN b.latitude IS NOT NULL AND b.longitude IS NOT NULL
        THEN SQRT(POWER(b.latitude - $${latIdx}, 2) + POWER(b.longitude - $${lngIdx}, 2)) * 111.32
        ELSE 999
      END AS distance_km`;
    orderBy = `ORDER BY distance_km ASC, b.created_at DESC`;
  }

  params.push(limit, offset);

  // completed bookings count for trust display — scalar subquery, no params needed
  const bookingCountSub = `(SELECT COUNT(*)::INT FROM bookings bk WHERE bk.board_id = b.id AND bk.status = 'completed')`;

  const result = await pool.query(`
    SELECT
      b.*,
      u.name AS host_name,
      u.avatar_url AS host_avatar,
      u.identity_status AS host_identity_status,
      u.stripe_charges_enabled AS host_charges_enabled,
      u.created_at AS host_member_since,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count,
      s.name AS spot_name,
      s.slug AS spot_slug,
      s.wave_type AS spot_wave_type,
      s.level AS spot_level,
      hm.tier AS host_tier,
      hm.trust_score AS host_trust_score,
      ${bookingCountSub} AS total_completed_bookings
      ${distanceSelect}
    FROM boards b
    JOIN users u ON u.id = b.host_id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    LEFT JOIN host_metrics hm ON hm.host_id = u.id
    ${where}
    GROUP BY b.id, u.name, u.avatar_url, u.identity_status, u.stripe_charges_enabled, u.created_at, s.name, s.slug, s.wave_type, s.level, hm.tier, hm.trust_score
    ${orderBy}
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return result.rows;
}

async function getBoardById(id) {
  const result = await pool.query(`
    SELECT
      b.*,
      u.name AS host_name,
      u.avatar_url AS host_avatar,
      u.bio AS host_bio,
      u.best_surf_trip_text AS host_best_surf_trip,
      u.host_since,
      u.location AS host_location,
      u.identity_status AS host_identity_status,
      u.stripe_charges_enabled AS host_charges_enabled,
      u.phone AS host_phone,
      u.created_at AS host_member_since,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count,
      s.name AS spot_name,
      s.slug AS spot_slug,
      s.wave_type AS spot_wave_type,
      s.level AS spot_level,
      s.description AS spot_description,
      s.latitude AS spot_lat,
      s.longitude AS spot_lng,
      hm.tier AS host_tier,
      hm.trust_score AS host_trust_score,
      (SELECT COUNT(*)::INT FROM bookings bk WHERE bk.board_id = b.id AND bk.status = 'completed') AS total_completed_bookings,
      -- Bookings in last 30 days (for social proof: "Réservée X fois")
      (SELECT COUNT(*)::INT FROM bookings bk WHERE bk.board_id = b.id AND bk.status IN ('completed', 'confirmed') AND bk.created_at >= NOW() - INTERVAL '30 days') AS bookings_count_30d,
      -- Confirmed/pending bookings starting within next 7 days (for urgency signal)
      (SELECT COUNT(*)::INT FROM bookings bk WHERE bk.board_id = b.id AND bk.status IN ('confirmed', 'pending') AND bk.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS upcoming_bookings_7d,
      -- Listing age in days (for "Nouveau sur Swell" badge)
      EXTRACT(DAY FROM NOW() - COALESCE(b.created_at, NOW()))::INT AS listing_age_days
    FROM boards b
    JOIN users u ON u.id = b.host_id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    LEFT JOIN host_metrics hm ON hm.host_id = u.id
    WHERE b.id = $1
    GROUP BY b.id, u.name, u.avatar_url, u.bio, u.best_surf_trip_text, u.host_since, u.location, u.identity_status, u.stripe_charges_enabled, u.phone, u.created_at, s.name, s.slug, s.wave_type, s.level, s.description, s.latitude, s.longitude, hm.tier, hm.trust_score
  `, [id]);
  return result.rows[0] || null;
}

async function createBoard({ hostId, title, description, boardType, lengthFt, condition, dailyPriceCents, hourlyRateCents, location, region, latitude, longitude, photos, finsIncluded, leashIncluded, bagIncluded, skillLevel, damageWaiverEnabled, spotId, estimatedValueCents, isListed = true }) {
  const result = await pool.query(`
    INSERT INTO boards (host_id, title, description, board_type, length_ft, condition, daily_price_cents, hourly_rate_cents, location, region, latitude, longitude, photos, fins_included, leash_included, bag_included, skill_level, damage_waiver_enabled, spot_id, estimated_value_cents, is_listed)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING *
  `, [hostId, title, description, boardType, lengthFt, condition, dailyPriceCents, hourlyRateCents || null, location, region || 'hossegor', latitude, longitude, JSON.stringify(photos || []), finsIncluded || false, leashIncluded || false, bagIncluded || false, skillLevel || 'all', damageWaiverEnabled !== false, spotId || null, estimatedValueCents || null, isListed]);
  return result.rows[0];
}

// Activate all boards that were held pending KYC for a host — called on identity approval.
async function activatePendingKycBoards(hostId) {
  const result = await pool.query(`
    UPDATE boards SET is_listed = true, updated_at = NOW()
    WHERE host_id = $1 AND is_listed = false
    RETURNING id
  `, [hostId]);
  return result.rowCount;
}

async function updateBoard(id, hostId, fields) {
  const allowed = ['title', 'description', 'board_type', 'length_ft', 'condition', 'daily_price_cents', 'hourly_rate_cents', 'location', 'region', 'photos', 'is_available', 'is_listed', 'fins_included', 'leash_included', 'bag_included', 'skill_level', 'damage_waiver_enabled', 'spot_id', 'latitude', 'longitude', 'estimated_value_cents'];
  const updates = [];
  const params = [id, hostId];

  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      params.push(val);
      updates.push(`${key} = $${params.length}`);
    }
  }

  if (updates.length === 0) return null;
  updates.push(`updated_at = NOW()`);

  const result = await pool.query(`
    UPDATE boards SET ${updates.join(', ')}
    WHERE id = $1 AND host_id = $2
    RETURNING *
  `, params);
  return result.rows[0] || null;
}

// Count future confirmed/pending bookings — used to warn host before delisting.
async function getFutureBookingsCount(boardId, hostId) {
  const result = await pool.query(`
    SELECT COUNT(*) AS count
    FROM bookings bk
    JOIN boards b ON b.id = bk.board_id
    WHERE bk.board_id = $1
      AND b.host_id = $2
      AND bk.status IN ('confirmed', 'pending')
      AND bk.end_date >= CURRENT_DATE
  `, [boardId, hostId]);
  return parseInt(result.rows[0].count, 10);
}

async function delistBoard(id, hostId) {
  const result = await pool.query(
    'UPDATE boards SET is_listed = false, updated_at = NOW() WHERE id = $1 AND host_id = $2 RETURNING id',
    [id, hostId]
  );
  return result.rowCount > 0;
}

async function relistBoard(id, hostId) {
  const result = await pool.query(
    'UPDATE boards SET is_listed = true, updated_at = NOW() WHERE id = $1 AND host_id = $2 RETURNING id',
    [id, hostId]
  );
  return result.rowCount > 0;
}

async function getBoardsByHost(hostId) {
  const result = await pool.query(`
    SELECT
      b.*,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count,
      COUNT(DISTINCT bk.id) AS total_bookings
    FROM boards b
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    LEFT JOIN bookings bk ON bk.board_id = b.id AND bk.status = 'completed'
    WHERE b.host_id = $1
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `, [hostId]);
  return result.rows;
}

async function getReviewsForBoard(boardId) {
  const result = await pool.query(`
    SELECT r.*, u.name AS reviewer_name, u.avatar_url AS reviewer_avatar
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    WHERE r.board_id = $1 AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    ORDER BY r.published_at DESC
  `, [boardId]);
  return result.rows;
}

async function deleteBoard(boardId, hostId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Delete blocked dates first (FK)
    await client.query('DELETE FROM board_blocked_dates WHERE board_id = $1', [boardId]);
    // Delete the board (owner check)
    const result = await client.query(
      'DELETE FROM boards WHERE id = $1 AND host_id = $2 RETURNING id',
      [boardId, hostId]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('COMMIT');
    return { deleted: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Lightweight fetch of only estimated_value_cents — used by deposit route without full board join.
async function getBoardEstimatedValue(boardId) {
  const result = await pool.query('SELECT estimated_value_cents FROM boards WHERE id = $1', [boardId]);
  return result.rows[0]?.estimated_value_cents || 0;
}

/**
 * Homepage 'Disponibles maintenant' section.
 * Returns boards where:
 *   1. Host has Stripe Connect charges_enabled = true (can receive money)
 *   2. Board has at least one open hourly slot in the next 24h
 *   3. Board has ≥3 photos
 *   4. Board is listed
 * Sorted by verified hosts first, then by total completed bookings desc.
 * Limited to 6 cards for the homepage surface.
 */
async function getInstantBoards({ limit = 6 } = {}) {
  // Count boards that have at least one slot available today or tomorrow.
  // Uses EXISTS subquery — efficient even with many bookings.
  const result = await pool.query(`
    WITH available_boards AS (
      SELECT b.id
      FROM boards b
      JOIN users u ON u.id = b.host_id
      WHERE b.is_listed = true
        AND u.stripe_charges_enabled = true
        AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3
        AND EXISTS (
          SELECT 1 FROM generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day', INTERVAL '1 hour') AS dt(date)
          WHERE NOT EXISTS (
            SELECT 1 FROM board_blocked_dates bd
            WHERE bd.board_id = b.id AND bd.blocked_date = dt.date::date
          )
          AND NOT EXISTS (
            SELECT 1 FROM bookings bk
            WHERE bk.board_id = b.id
              AND bk.status NOT IN ('cancelled', 'expired')
              AND NOT (bk.status = 'pending' AND bk.pending_at < NOW() - INTERVAL '30 minutes')
              AND bk.start_date = dt.date::date
              AND bk.start_time IS NOT NULL
              AND EXTRACT(HOUR FROM bk.start_time)::int < 22
          )
        )
    )
    SELECT
      b.id, b.title, b.board_type, b.length_ft, b.hourly_rate_cents, b.daily_price_cents,
      b.photos, b.location, b.skill_level, b.spot_id,
      u.name AS host_name, u.avatar_url AS host_avatar,
      u.identity_status AS host_identity_status,
      u.stripe_charges_enabled AS host_stripe_verified,
      s.name AS spot_name, s.slug AS spot_slug,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count,
      COUNT(DISTINCT completed_bk.id) AS total_completed_bookings,
      -- Derived: is this a 'verified host' (stripe + KYC + ≥3 photos)?
      CASE WHEN u.stripe_charges_enabled = true
            AND u.identity_status = 'verified'
            AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3
           THEN true ELSE false
      END AS is_verified_host
    FROM available_boards ab
    JOIN boards b ON b.id = ab.id
    JOIN users u ON u.id = b.host_id
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    LEFT JOIN bookings completed_bk ON completed_bk.board_id = b.id AND completed_bk.status = 'completed'
    GROUP BY b.id, u.name, u.avatar_url, u.identity_status, u.stripe_charges_enabled,
             s.name, s.slug
    ORDER BY is_verified_host DESC, total_completed_bookings DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Search boards with optional date-range availability filter.
 * When fromDate+toDate are provided, only returns boards that have at least
 * one hour-window free on every requested day (no blocking row + no booking overlap).
 * All other filters (type, price, skill, spot, verifiedOnly) work identically to listBoards.
 */
async function searchBoards({
  fromDate, toDate, boardTypes, minPrice, maxPrice, skillLevel,
  spotId, verifiedOnly, limit = 24, offset = 0
} = {}) {
  const conditions = ['b.is_listed = true'];
  const params = [];

  // Multiple board types via IN (checkboxes)
  if (boardTypes && boardTypes.length > 0) {
    const placeholders = boardTypes.map((_, i) => `$${params.length + i + 1}`).join(',');
    boardTypes.forEach(t => params.push(t));
    conditions.push(`b.board_type IN (${placeholders})`);
  }
  if (minPrice != null) {
    params.push(minPrice * 100);
    conditions.push(`b.hourly_rate_cents >= $${params.length}`);
  }
  if (maxPrice != null) {
    params.push(maxPrice * 100);
    conditions.push(`b.hourly_rate_cents <= $${params.length}`);
  }
  if (skillLevel) {
    params.push(skillLevel);
    conditions.push(`(b.skill_level = $${params.length} OR b.skill_level = 'all')`);
  }
  if (spotId) {
    params.push(spotId);
    conditions.push(`b.spot_id = $${params.length}`);
  }
  // Verified host = Stripe charges enabled + KYC verified + ≥3 photos
  if (verifiedOnly) {
    conditions.push(`u.stripe_charges_enabled = true`);
    conditions.push(`u.identity_status = 'verified'`);
    conditions.push(`jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3`);
  }

  // Date availability filter: board must not be fully blocked on any day in the window.
  // A day is "blocked" if it has a board_blocked_dates row OR an active booking covering it.
  // We only require at least one free slot (exists) — not full-day availability.
  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    const pFrom = params.length - 1;
    const pTo = params.length;
    conditions.push(`
      NOT EXISTS (
        SELECT 1
        FROM generate_series($${pFrom}::date, $${pTo}::date, INTERVAL '1 day') AS gs(d)
        WHERE
          EXISTS (
            SELECT 1 FROM board_blocked_dates bd
            WHERE bd.board_id = b.id AND bd.blocked_date = gs.d
          )
          OR EXISTS (
            SELECT 1 FROM bookings bk
            WHERE bk.board_id = b.id
              AND bk.status NOT IN ('cancelled', 'expired')
              AND bk.start_date <= gs.d
              AND bk.end_date >= gs.d
          )
      )
    `);
  }

  const where = 'WHERE ' + conditions.join(' AND ');
  params.push(limit, offset);

  const bookingCountSub = `(SELECT COUNT(*)::INT FROM bookings bk WHERE bk.board_id = b.id AND bk.status = 'completed')`;

  const result = await pool.query(`
    SELECT
      b.id, b.title, b.board_type, b.length_ft, b.condition,
      b.hourly_rate_cents, b.daily_price_cents, b.photos, b.skill_level,
      b.spot_id, b.damage_waiver_enabled, b.fins_included, b.leash_included,
      u.name AS host_name, u.avatar_url AS host_avatar,
      u.identity_status AS host_identity_status,
      u.stripe_charges_enabled AS host_charges_enabled,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count,
      s.name AS spot_name, s.slug AS spot_slug, s.region AS spot_region,
      hm.tier AS host_tier,
      ${bookingCountSub} AS total_completed_bookings,
      CASE WHEN u.stripe_charges_enabled = true
            AND u.identity_status = 'verified'
            AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3
           THEN true ELSE false
      END AS is_verified_host
    FROM boards b
    JOIN users u ON u.id = b.host_id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    LEFT JOIN host_metrics hm ON hm.host_id = u.id
    ${where}
    GROUP BY b.id, u.name, u.avatar_url, u.identity_status, u.stripe_charges_enabled,
             s.name, s.slug, s.region, hm.tier
    ORDER BY is_verified_host DESC, total_completed_bookings DESC, b.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return result.rows;
}

/**
 * Count total results for searchBoards (same filters, no pagination).
 * Used to show "X planches trouvées" in the UI.
 */
async function countSearchBoards({
  fromDate, toDate, boardTypes, minPrice, maxPrice, skillLevel,
  spotId, verifiedOnly
} = {}) {
  const conditions = ['b.is_listed = true'];
  const params = [];

  if (boardTypes && boardTypes.length > 0) {
    const placeholders = boardTypes.map((_, i) => `$${params.length + i + 1}`).join(',');
    boardTypes.forEach(t => params.push(t));
    conditions.push(`b.board_type IN (${placeholders})`);
  }
  if (minPrice != null) {
    params.push(minPrice * 100);
    conditions.push(`b.hourly_rate_cents >= $${params.length}`);
  }
  if (maxPrice != null) {
    params.push(maxPrice * 100);
    conditions.push(`b.hourly_rate_cents <= $${params.length}`);
  }
  if (skillLevel) {
    params.push(skillLevel);
    conditions.push(`(b.skill_level = $${params.length} OR b.skill_level = 'all')`);
  }
  if (spotId) {
    params.push(spotId);
    conditions.push(`b.spot_id = $${params.length}`);
  }
  if (verifiedOnly) {
    conditions.push(`u.stripe_charges_enabled = true`);
    conditions.push(`u.identity_status = 'verified'`);
    conditions.push(`jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3`);
  }
  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    const pFrom = params.length - 1;
    const pTo = params.length;
    conditions.push(`
      NOT EXISTS (
        SELECT 1
        FROM generate_series($${pFrom}::date, $${pTo}::date, INTERVAL '1 day') AS gs(d)
        WHERE
          EXISTS (
            SELECT 1 FROM board_blocked_dates bd
            WHERE bd.board_id = b.id AND bd.blocked_date = gs.d
          )
          OR EXISTS (
            SELECT 1 FROM bookings bk
            WHERE bk.board_id = b.id
              AND bk.status NOT IN ('cancelled', 'expired')
              AND bk.start_date <= gs.d
              AND bk.end_date >= gs.d
          )
      )
    `);
  }

  const where = 'WHERE ' + conditions.join(' AND ');
  const result = await pool.query(`
    SELECT COUNT(DISTINCT b.id)::INT AS total
    FROM boards b
    JOIN users u ON u.id = b.host_id
    ${where}
  `, params);
  return result.rows[0].total;
}

/**
 * Returns up to 6 boards at the same spot or adjacent spots (within 20km),
 * excluding the current board. Used for the "Autres boards à [spot]" carousel.
 * Uses Euclidean distance (fine for coastal range — avoids PostGIS).
 * Falls back to same board_type if <2 results from distance filter.
 */
async function getRelatedBoards(boardId, spotId, spotLat, spotLng, boardType, limit = 6) {
  const params = [boardId];
  let query;

  if (spotLat != null && spotLng != null) {
    // Primary: same spot, then adjacent (within 20km via lat/lng)
    // $1=boardId, $2=spotLat, $3=spotLng, $4=spotId, $5=limit
    params.push(spotLat, spotLng, spotId, limit);
    query = `
      SELECT
        b.id, b.title, b.board_type, b.length_ft,
        b.hourly_rate_cents, b.daily_price_cents, b.photos, b.skill_level,
        s.name AS spot_name, s.slug AS spot_slug,
        u.name AS host_name, u.avatar_url AS host_avatar,
        u.identity_status AS host_identity_status,
        COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
        COUNT(DISTINCT r.id)::INT AS review_count,
        CASE WHEN b.spot_id = $4 THEN 0 ELSE
          SQRT(POWER(COALESCE(s.latitude, 0) - $2, 2) + POWER(COALESCE(s.longitude, 0) - $3, 2)) * 111.32
        END AS distance_km,
        CASE WHEN u.stripe_charges_enabled = true AND u.identity_status = 'verified' AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3 THEN true ELSE false END AS is_verified_host
      FROM boards b
      JOIN users u ON u.id = b.host_id
      LEFT JOIN surf_spots s ON s.id = b.spot_id
      LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
      WHERE b.id != $1
        AND b.is_listed = true
        AND u.stripe_charges_enabled = true
        AND (
          b.spot_id = $4
          OR (s.latitude IS NOT NULL AND s.longitude IS NOT NULL AND SQRT(POWER(s.latitude - $2, 2) + POWER(s.longitude - $3, 2)) * 111.32 <= 20)
        )
      GROUP BY b.id, u.name, u.avatar_url, u.identity_status, u.stripe_charges_enabled,
               s.name, s.slug, s.latitude, s.longitude, b.spot_id
      ORDER BY distance_km ASC, b.created_at DESC
      LIMIT $5
    `;
  } else if (boardType) {
    // Fallback: same board_type, listed, payment-enabled, ≤6 results
    params.push(boardType, limit);
    query = `
      SELECT
        b.id, b.title, b.board_type, b.length_ft,
        b.hourly_rate_cents, b.daily_price_cents, b.photos, b.skill_level,
        s.name AS spot_name, s.slug AS spot_slug,
        u.name AS host_name, u.avatar_url AS host_avatar,
        u.identity_status AS host_identity_status,
        COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
        COUNT(DISTINCT r.id)::INT AS review_count,
        999 AS distance_km,
        CASE WHEN u.stripe_charges_enabled = true AND u.identity_status = 'verified' AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3 THEN true ELSE false END AS is_verified_host
      FROM boards b
      JOIN users u ON u.id = b.host_id
      LEFT JOIN surf_spots s ON s.id = b.spot_id
      LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
      WHERE b.id != $1
        AND b.is_listed = true
        AND b.board_type = $2
        AND u.stripe_charges_enabled = true
      GROUP BY b.id, u.name, u.avatar_url, u.identity_status, u.stripe_charges_enabled, s.name, s.slug
      ORDER BY b.created_at DESC
      LIMIT $3
    `;
  } else {
    // No data to filter by — return empty (shouldn't happen with real board data)
    return [];
  }

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Count free hourly slots on the next coming Saturday + Sunday for a board.
 * Counts unblocked hours (6–22) not covered by an active booking.
 * Returns { sat_free, sun_free } — both 0 if no data (board always appears available by default).
 */
async function getWeekendAvailableHours(boardId) {
  const result = await pool.query(`
    WITH weekend AS (
      -- Next Saturday and Sunday (handles any day of week)
      SELECT
        CURRENT_DATE + (6 - EXTRACT(ISODOW FROM CURRENT_DATE)::INT + 7) % 7 AS saturday,
        CURRENT_DATE + (7 - EXTRACT(ISODOW FROM CURRENT_DATE)::INT + 7) % 7 AS sunday
    ),
    hours AS (SELECT generate_series(6, 21) AS h),
    sat_blocked AS (
      SELECT COUNT(*)::INT AS n
      FROM weekend, hours
      WHERE EXISTS (SELECT 1 FROM board_blocked_dates bd WHERE bd.board_id = $1 AND bd.blocked_date = weekend.saturday)
         OR EXISTS (
           SELECT 1 FROM bookings bk
           WHERE bk.board_id = $1
             AND bk.status NOT IN ('cancelled','expired')
             AND bk.start_date = weekend.saturday
             AND bk.start_time IS NOT NULL
             AND EXTRACT(HOUR FROM bk.start_time)::INT <= hours.h
             AND EXTRACT(HOUR FROM COALESCE(bk.end_time, bk.start_time + INTERVAL '2 hours'))::INT > hours.h
         )
    ),
    sun_blocked AS (
      SELECT COUNT(*)::INT AS n
      FROM weekend, hours
      WHERE EXISTS (SELECT 1 FROM board_blocked_dates bd WHERE bd.board_id = $1 AND bd.blocked_date = weekend.sunday)
         OR EXISTS (
           SELECT 1 FROM bookings bk
           WHERE bk.board_id = $1
             AND bk.status NOT IN ('cancelled','expired')
             AND bk.start_date = weekend.sunday
             AND bk.start_time IS NOT NULL
             AND EXTRACT(HOUR FROM bk.start_time)::INT <= hours.h
             AND EXTRACT(HOUR FROM COALESCE(bk.end_time, bk.start_time + INTERVAL '2 hours'))::INT > hours.h
         )
    )
    SELECT
      GREATEST(0, 16 - sat_blocked.n) AS sat_free,
      GREATEST(0, 16 - sun_blocked.n) AS sun_free
    FROM sat_blocked, sun_blocked
  `, [boardId]);
  return result.rows[0] || { sat_free: 16, sun_free: 16 };
}

module.exports = {
  listBoards, getBoardById, createBoard, updateBoard, delistBoard, relistBoard,
  getFutureBookingsCount, getBoardsByHost, getReviewsForBoard, deleteBoard,
  getBoardEstimatedValue, activatePendingKycBoards, getInstantBoards,
  searchBoards, countSearchBoards, getRelatedBoards, getWeekendAvailableHours
};
