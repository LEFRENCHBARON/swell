// What this module owns: all queries for rental_events (SWELL_EVENT_STORE).
// Does NOT handle HTTP, pattern analysis, or scoring. Append-only by design.
const pool = require('./index');

// Generate QE-XXXXXXXXXX event ID
function makeEventId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `QE-${ts}${rand}`;
}

// Append one rental event. Called on booking completion.
async function appendRentalEvent(data) {
  const eventId = makeEventId();
  const result = await pool.query(`
    INSERT INTO rental_events (
      event_id, booking_id, weather, swell_height, swell_period, swell_direction,
      spot_id, board_id, rider_id, rider_level, rider_experience_rented_board_type,
      return_condition, micro_impacts, return_time_delta,
      satisfaction_score, hidden_cost_cents, incident_reported, risk_score
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, $14,
      $15, $16, $17, $18
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING *
  `, [
    eventId,
    data.booking_id,
    data.weather || null,
    data.swell_height || null,
    data.swell_period || null,
    data.swell_direction || null,
    data.spot_id || null,
    data.board_id,
    data.rider_id,
    data.rider_level || null,
    data.rider_experience_rented_board_type || false,
    data.return_condition || 'perfect',
    JSON.stringify(data.micro_impacts || []),
    data.return_time_delta || 0,
    data.satisfaction_score || null,
    data.hidden_cost_cents || 0,
    data.incident_reported || false,
    data.risk_score || 1.0
  ]);
  return result.rows[0];
}

// Get all events for a board — used by Genome to compute patterns.
async function getEventsByBoard(boardId, limit = 50) {
  const result = await pool.query(`
    SELECT re.*, ss.name AS spot_name
    FROM rental_events re
    LEFT JOIN surf_spots ss ON ss.id = re.spot_id
    WHERE re.board_id = $1
    ORDER BY re.created_at DESC
    LIMIT $2
  `, [boardId, limit]);
  return result.rows;
}

// Get all events for a spot — used by Failure Atlas to learn damage patterns.
async function getEventsBySpot(spotId, limit = 100) {
  const result = await pool.query(`
    SELECT re.*, b.board_type, b.length_ft
    FROM rental_events re
    LEFT JOIN boards b ON b.id = re.board_id
    WHERE re.spot_id = $1
    ORDER BY re.created_at DESC
    LIMIT $2
  `, [spotId, limit]);
  return result.rows;
}

// Compute damage patterns per spot from real event data — feeds Failure Atlas refresh.
async function computeSpotDamageProfile(spotId) {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total_events,
      COUNT(*) FILTER (WHERE return_condition != 'perfect') AS incident_count,
      AVG(hidden_cost_cents) AS avg_hidden_cost,
      SUM(CASE WHEN return_condition = 'perfect' THEN 0
               WHEN return_condition = 'minor_damage' THEN 1
               WHEN return_condition = 'significant_damage' THEN 3
               WHEN return_condition = 'major_damage' THEN 5
               ELSE 0 END)::NUMERIC / NULLIF(COUNT(*), 0) AS weighted_damage_index
    FROM rental_events
    WHERE spot_id = $1
  `, [spotId]);
  return result.rows[0];
}

// Detect patterns: "beginner + PU + this spot = x% damage rate"
async function detectPatterns(spotId) {
  const result = await pool.query(`
    SELECT
      rider_level,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE return_condition != 'perfect') AS incidents,
      ROUND(
        COUNT(*) FILTER (WHERE return_condition != 'perfect')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 1
      ) AS incident_rate_pct
    FROM rental_events
    WHERE spot_id = $1
    GROUP BY rider_level
    ORDER BY incident_rate_pct DESC NULLS LAST
  `, [spotId]);
  return result.rows;
}

// Get aggregate event stats — used by admin dashboard / insights.
async function getEventStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total_events,
      COUNT(*) FILTER (WHERE return_condition = 'perfect') AS perfect_returns,
      COUNT(*) FILTER (WHERE incident_reported = true) AS reported_incidents,
      AVG(satisfaction_score) FILTER (WHERE satisfaction_score IS NOT NULL) AS avg_satisfaction,
      AVG(hidden_cost_cents) AS avg_hidden_cost,
      SUM(hidden_cost_cents) AS total_hidden_cost
    FROM rental_events
  `);
  return result.rows[0];
}

// Recent events feed — for admin monitoring.
async function getRecentEvents(limit = 20) {
  const result = await pool.query(`
    SELECT
      re.*,
      b.title AS board_title, b.board_type,
      u.name AS rider_name,
      ss.name AS spot_name
    FROM rental_events re
    LEFT JOIN boards b ON b.id = re.board_id
    LEFT JOIN users u ON u.id = re.rider_id
    LEFT JOIN surf_spots ss ON ss.id = re.spot_id
    ORDER BY re.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

module.exports = {
  appendRentalEvent,
  getEventsByBoard,
  getEventsBySpot,
  computeSpotDamageProfile,
  detectPatterns,
  getEventStats,
  getRecentEvents
};
