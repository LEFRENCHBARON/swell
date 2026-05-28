// What this module owns: host activation status queries — Verified Host checklist data.
// Does NOT own user auth, board CRUD, or payment processing logic.
const pool = require('./index');

/**
 * Fetch full activation status for a single host.
 * Returns user stripe/KYC fields + all boards with photo count and
 * whether hourly pricing is set. Availability check done separately.
 */
async function getHostActivationStatus(hostId) {
  const userResult = await pool.query(`
    SELECT
      id,
      name,
      email,
      stripe_charges_enabled,
      stripe_payouts_enabled,
      stripe_onboarding_completed_at,
      identity_status,
      identity_doc_url,
      identity_doc_back_url,
      avatar_url
    FROM users
    WHERE id = $1
  `, [hostId]);

  const user = userResult.rows[0];
  if (!user) return null;

  const boardsResult = await pool.query(`
    SELECT
      b.id,
      b.title,
      b.board_type,
      b.photos,
      b.hourly_rate_cents,
      b.is_listed,
      jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) AS photo_count
    FROM boards b
    WHERE b.host_id = $1
    ORDER BY b.created_at ASC
  `, [hostId]);

  return { user, boards: boardsResult.rows };
}

/**
 * Count distinct availability slots for a host's boards in the next 14 days.
 * We check board_blocked_slots — a board has "availability set" if it has
 * at least some non-blocked hours, OR if it has zero blocked slots at all
 * (available by default). So we use an inverse: a board has no availability
 * if ALL hours for the next 14 days are blocked.
 *
 * Simpler heuristic: board has availability populated if it has at least
 * one NON-blocked slot in the next 14 days. Since default = available,
 * we flag the board as "availability set" if it has fewer than (14*16) blocked slots
 * — meaning at least some time is still open. Most hosts will have 0 blocked slots,
 * meaning fully available, which counts as populated.
 *
 * Returns: array of { boardId, hasAvailability: bool }
 */
async function getBoardAvailabilitySummary(hostId) {
  // A board is "available" if it has at least 1 open slot in the next 14 days.
  // Default model: absent from board_blocked_slots = open.
  // So a board with NO blocked slots = fully open = available.
  // A board with ALL 14*16=224 slots blocked = unavailable.
  const result = await pool.query(`
    SELECT
      b.id AS board_id,
      COUNT(bs.id) AS blocked_slot_count
    FROM boards b
    LEFT JOIN board_blocked_slots bs
      ON bs.board_id = b.id
      AND bs.blocked_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
    WHERE b.host_id = $1
    GROUP BY b.id
  `, [hostId]);

  return result.rows.map(r => ({
    boardId: r.board_id,
    // 14 days * 16 operating hours = 224 max slots; if all blocked, unavailable
    hasAvailability: parseInt(r.blocked_slot_count) < 224
  }));
}

/**
 * Fetch all hosts (is_host = true) with their activation data for the email blast.
 * Returns minimal fields needed to compute % complete and personalise the email.
 */
async function getAllHostsForEmailBlast() {
  const result = await pool.query(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.stripe_charges_enabled,
      u.stripe_payouts_enabled,
      u.identity_status,
      u.identity_doc_url,
      u.identity_doc_back_url,
      COALESCE(
        json_agg(
          json_build_object(
            'id', b.id,
            'title', b.title,
            'photo_count', jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)),
            'hourly_rate_cents', b.hourly_rate_cents
          )
        ) FILTER (WHERE b.id IS NOT NULL),
        '[]'
      ) AS boards
    FROM users u
    LEFT JOIN boards b ON b.host_id = u.id
    WHERE u.is_host = true
    GROUP BY u.id
    ORDER BY u.created_at ASC
  `);

  return result.rows;
}

module.exports = {
  getHostActivationStatus,
  getBoardAvailabilitySummary,
  getAllHostsForEmailBlast,
};
