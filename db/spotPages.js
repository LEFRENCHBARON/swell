// What this module owns: aggregated queries for /spot/:slug landing pages.
// Combines spots, boards, failure_zones, and reviews into page-ready data.
// Does NOT handle HTTP or HTML rendering — that's routes/spot-pages.js.
const pool = require('./index');

/**
 * Fetch a spot region or individual spot by slug for the spot landing page.
 * Returns: spot info, all sub-spots (if region), boards, failure zones, reviews.
 * Boards include is_verified_host (stripe + KYC + ≥3 photos) for badge display.
 */
async function getSpotPageData(slug, { verifiedOnly = false } = {}) {
  // First try to match a region (hossegor, seignosse, capbreton)
  const regionResult = await pool.query(
    `SELECT * FROM surf_spots WHERE region = $1 ORDER BY name`,
    [slug]
  );

  let spots;
  let isRegion = false;

  if (regionResult.rows.length > 0) {
    spots = regionResult.rows;
    isRegion = true;
  } else {
    // Try matching a single spot slug (cote-des-basques, lafitenia)
    const spotResult = await pool.query(
      `SELECT * FROM surf_spots WHERE slug = $1`,
      [slug]
    );
    if (spotResult.rows.length === 0) return null;
    spots = spotResult.rows;
  }

  const spotIds = spots.map(s => s.id);
  const placeholders = spotIds.map((_, i) => `$${i + 1}`).join(',');
  const p = [...spotIds];
  const baseWhere = `b.is_listed = true AND b.spot_id IN (${placeholders})`;

  // Boards: listed boards at these spots, sorted verified hosts first
  const verifiedJoin = verifiedOnly
    ? `AND u.stripe_charges_enabled = true
       AND u.identity_status = 'verified'
       AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3`
    : '';

  p.push(20);
  const boardsResult = await pool.query(`
    SELECT
      b.id, b.title, b.board_type, b.length_ft, b.condition, b.daily_price_cents,
      b.hourly_rate_cents, b.location, b.photos, b.skill_level, b.damage_waiver_enabled,
      b.fins_included, b.leash_included, b.bag_included,
      u.name AS host_name, u.avatar_url AS host_avatar,
      u.identity_status AS host_identity_status,
      u.stripe_charges_enabled AS host_stripe_verified,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT r.id) AS review_count,
      COUNT(DISTINCT completed_bk.id) AS total_completed_bookings,
      s.name AS spot_name, s.slug AS spot_slug,
      CASE WHEN u.stripe_charges_enabled = true
                AND u.identity_status = 'verified'
                AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3
           THEN true ELSE false
      END AS is_verified_host
    FROM boards b
    JOIN users u ON u.id = b.host_id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    LEFT JOIN bookings completed_bk ON completed_bk.board_id = b.id AND completed_bk.status = 'completed'
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    WHERE ${baseWhere} ${verifiedJoin}
    GROUP BY b.id, u.name, u.avatar_url, u.identity_status, u.stripe_charges_enabled, s.name, s.slug
    ORDER BY is_verified_host DESC, total_completed_bookings DESC, b.created_at DESC
    LIMIT $${p.length}
  `, p);

  // Failure zones for these spots
  const zonesResult = await pool.query(`
    SELECT fz.*, ss.name AS spot_name, ss.slug AS spot_slug
    FROM failure_zones fz
    JOIN surf_spots ss ON ss.id = fz.spot_id
    WHERE fz.spot_id IN (${placeholders})
    ORDER BY fz.damage_multiplier DESC
  `, spotIds);

  // Recent published reviews for boards at these spots
  const reviewsResult = await pool.query(`
    SELECT r.rating, r.comment, r.published_at, r.reviewer_role,
      u.name AS reviewer_name, u.avatar_url AS reviewer_avatar,
      b.title AS board_title, s.name AS spot_name
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    JOIN boards b ON b.id = r.board_id
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    WHERE r.published_at IS NOT NULL
      AND r.reviewer_role = 'renter'
      AND b.spot_id IN (${placeholders})
    ORDER BY r.published_at DESC
    LIMIT 10
  `, spotIds);

  return {
    spots,
    isRegion,
    primarySpot: spots[0],
    boards: boardsResult.rows,
    failureZones: zonesResult.rows,
    reviews: reviewsResult.rows,
    verifiedOnly,
  };
}

/**
 * Count boards available today (listed + not blocked today).
 * Used for the sticky spot-page counter.
 */
async function getSpotAvailableTodayCount(spotIds) {
  const placeholders = spotIds.map((_, i) => `$${i + 1}`).join(',');
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM boards b
    JOIN users u ON u.id = b.host_id
    WHERE b.is_listed = true
      AND b.spot_id IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM board_blocked_dates bd
        WHERE bd.board_id = b.id AND bd.blocked_date = CURRENT_DATE
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings bk
        WHERE bk.board_id = b.id
          AND bk.status NOT IN ('cancelled', 'expired')
          AND NOT (bk.status = 'pending' AND bk.pending_at < NOW() - INTERVAL '30 minutes')
          AND bk.start_date = CURRENT_DATE
          AND bk.start_time IS NOT NULL
      )
  `, spotIds);
  return result.rows[0]?.count || 0;
}

/**
 * Return up to N nearest spots (by Euclidean lat/lng distance), excluding the current spot IDs.
 * Used for the "Autres spots proches" internal linking section.
 */
async function getNearbySpots(lat, lng, excludeIds, limit = 4) {
  if (!lat || !lng) return [];
  // params: [$1=lat, $2=lng, $3=limit, $4..=excludeIds]
  // excludeIds start at offset 4 (1-indexed), so $${i + 4}
  const excludeClause = excludeIds.length > 0
    ? `AND id NOT IN (${excludeIds.map((_, i) => `$${i + 4}`).join(',')})`
    : '';
  const params = [parseFloat(lat), parseFloat(lng), limit, ...excludeIds];
  const result = await pool.query(`
    SELECT id, name, slug, region, wave_type, level, latitude, longitude,
      SQRT(POWER(latitude - $1, 2) + POWER(longitude - $2, 2)) AS dist
    FROM surf_spots
    WHERE slug IS NOT NULL ${excludeClause}
    ORDER BY dist ASC
    LIMIT $3
  `, params);
  return result.rows;
}

/**
 * Fetch approved/active partners near a spot by partial location match.
 * Falls back to all active partners if none match.
 */
async function getPartnersByLocation(locationKeywords, limit = 3) {
  if (!locationKeywords || locationKeywords.length === 0) {
    const result = await pool.query(
      `SELECT id, name, type, location, website FROM partners WHERE status IN ('approved','active') ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
  // Try matching any of the location keywords (case-insensitive)
  const conditions = locationKeywords.map((_, i) => `location ILIKE $${i + 2}`).join(' OR ');
  const params = [limit, ...locationKeywords.map(k => `%${k}%`)];
  const result = await pool.query(
    `SELECT id, name, type, location, website FROM partners WHERE status IN ('approved','active') AND (${conditions}) ORDER BY created_at DESC LIMIT $1`,
    params
  );
  return result.rows;
}

module.exports = { getSpotPageData, getSpotAvailableTodayCount, getNearbySpots, getPartnersByLocation };
