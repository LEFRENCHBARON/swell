// What this module owns: all database queries for the surf_spots table.
// Does NOT handle boards, HTTP, or any other domain.
const pool = require('./index');

/**
 * Return all surf spots, ordered by region then name.
 * Lightweight — no pagination needed (< 25 rows total).
 */
async function listSpots() {
  const result = await pool.query(`
    SELECT
      s.*,
      COUNT(b.id) AS board_count
    FROM surf_spots s
    LEFT JOIN boards b ON b.spot_id = s.id AND b.is_listed = true
    GROUP BY s.id
    ORDER BY s.region, s.name
  `);
  return result.rows;
}

/**
 * Find spots whose name or slug matches a search string (autocomplete).
 * Returns max 8 results ranked by name similarity.
 */
async function searchSpots(query) {
  const result = await pool.query(`
    SELECT
      s.*,
      COUNT(b.id) AS board_count
    FROM surf_spots s
    LEFT JOIN boards b ON b.spot_id = s.id AND b.is_listed = true
    WHERE s.name ILIKE $1 OR s.region ILIKE $1 OR s.slug ILIKE $1
    GROUP BY s.id
    ORDER BY
      CASE WHEN s.name ILIKE $2 THEN 0
           WHEN s.name ILIKE $1 THEN 1
           ELSE 2
      END,
      s.name
    LIMIT 8
  `, [`%${query}%`, `${query}%`]);
  return result.rows;
}

/**
 * Find the nearest spot to a lat/lng coordinate.
 * Uses Euclidean distance approximation (fine for < 200km range).
 */
async function getNearestSpot(latitude, longitude) {
  const result = await pool.query(`
    SELECT *,
      SQRT(POWER(latitude - $1, 2) + POWER(longitude - $2, 2)) AS dist
    FROM surf_spots
    ORDER BY dist
    LIMIT 1
  `, [latitude, longitude]);
  return result.rows[0] || null;
}

/**
 * Get a single spot by slug, with board count.
 */
async function getSpotBySlug(slug) {
  const result = await pool.query(`
    SELECT
      s.*,
      COUNT(b.id) AS board_count
    FROM surf_spots s
    LEFT JOIN boards b ON b.spot_id = s.id AND b.is_listed = true
    WHERE s.slug = $1
    GROUP BY s.id
  `, [slug]);
  return result.rows[0] || null;
}

/**
 * Get boards for a spot, grouped by skill level, with hourly + daily pricing.
 * Used for /spots/:slug landing pages.
 */
async function getBoardsByLevel(spotSlug) {
  // boards are stored with region = spot slug, not spot_id
  const regionResult = await pool.query(
    `SELECT id FROM surf_spots WHERE region = $1 LIMIT 1`,
    [spotSlug]
  );
  const slugResult = await pool.query(
    `SELECT id FROM surf_spots WHERE slug = $1 LIMIT 1`,
    [spotSlug]
  );
  const spotIds = regionResult.rows.length
    ? [regionResult.rows[0].id]
    : slugResult.rows.length
    ? [slugResult.rows[0].id]
    : [];

  if (spotIds.length === 0) {
    // fallback: boards with matching region column
    const result = await pool.query(`
      SELECT
        b.id, b.title, b.board_type, b.length_ft, b.condition,
        b.daily_price_cents, b.hourly_rate_cents, b.photos, b.skill_level,
        u.name AS host_name, u.avatar_url AS host_avatar, u.identity_status AS host_identity_status,
        COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count
      FROM boards b
      JOIN users u ON u.id = b.host_id
      LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
      WHERE b.is_listed = true AND b.region = $1
      GROUP BY b.id, u.name, u.avatar_url, u.identity_status
      ORDER BY b.created_at DESC
      LIMIT 20
    `, [spotSlug]);
    return result.rows;
  }

  const placeholders = spotIds.map((_, i) => `$${i + 1}`).join(',');
  const result = await pool.query(`
    SELECT
      b.id, b.title, b.board_type, b.length_ft, b.condition,
      b.daily_price_cents, b.hourly_rate_cents, b.photos, b.skill_level,
      u.name AS host_name, u.avatar_url AS host_avatar, u.identity_status AS host_identity_status,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count
    FROM boards b
    JOIN users u ON u.id = b.host_id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    WHERE b.is_listed = true AND b.spot_id IN (${placeholders})
    GROUP BY b.id, u.name, u.avatar_url, u.identity_status
    ORDER BY b.created_at DESC
    LIMIT 20
  `, spotIds);
  return result.rows;
}

/**
 * Return spots with board counts for the discovery map.
 * filterAvailable=true restricts to spots with boards that have no booking
 * conflict in the window [fromDate, toDate] (YYYY-MM-DD strings).
 */
async function listSpotsForMap({ filterAvailable = false, fromDate, toDate } = {}) {
  let query;
  let params = [];

  if (filterAvailable && fromDate && toDate) {
    query = `
      SELECT
        s.id, s.name, s.slug, s.latitude, s.longitude,
        s.region, s.wave_type, s.level,
        COUNT(DISTINCT b.id) AS board_count,
        MIN(b.hourly_rate_cents) AS min_hourly_cents,
        (
          SELECT jsonb_build_object('url', (ph.photos->0)::text)
          FROM boards ph
          WHERE ph.spot_id = s.id
            AND ph.is_listed = true
            AND ph.photos IS NOT NULL
            AND jsonb_array_length(ph.photos) > 0
            AND NOT EXISTS (
              SELECT 1 FROM bookings bk
              WHERE bk.board_id = ph.id
                AND bk.status IN ('pending','confirmed')
                AND bk.start_date <= $2
                AND bk.end_date >= $1
            )
          LIMIT 1
        ) AS sample_photo
      FROM surf_spots s
      LEFT JOIN boards b ON b.spot_id = s.id
        AND b.is_listed = true
        AND NOT EXISTS (
          SELECT 1 FROM bookings bk
          WHERE bk.board_id = b.id
            AND bk.status IN ('pending','confirmed')
            AND bk.start_date <= $2
            AND bk.end_date >= $1
        )
      WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
      GROUP BY s.id
      HAVING COUNT(DISTINCT b.id) > 0
      ORDER BY board_count DESC, s.name
    `;
    params = [fromDate, toDate];
  } else {
    query = `
      SELECT
        s.id, s.name, s.slug, s.latitude, s.longitude,
        s.region, s.wave_type, s.level,
        COUNT(DISTINCT b.id) AS board_count,
        MIN(b.hourly_rate_cents) AS min_hourly_cents,
        (
          SELECT jsonb_build_object('url', (ph.photos->0)::text)
          FROM boards ph
          WHERE ph.spot_id = s.id
            AND ph.is_listed = true
            AND ph.photos IS NOT NULL
            AND jsonb_array_length(ph.photos) > 0
          LIMIT 1
        ) AS sample_photo
      FROM surf_spots s
      LEFT JOIN boards b ON b.spot_id = s.id AND b.is_listed = true
      WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
      GROUP BY s.id
      ORDER BY board_count DESC, s.name
    `;
  }

  const result = await pool.query(query, params);
  return result.rows;
}

module.exports = { listSpots, searchSpots, getNearestSpot, getSpotBySlug, getBoardsByLevel, listSpotsForMap };
