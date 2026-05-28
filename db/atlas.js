// What this module owns: all queries for failure_zones (SWELL_FAILURE_ATLAS).
// Does NOT handle HTTP, swell data fetching, or booking validation.
const pool = require('./index');

// Get all failure zones, optionally filtered by spot.
async function getFailureZones(spotId = null) {
  const params = [];
  let where = '';
  if (spotId) {
    params.push(spotId);
    where = `WHERE fz.spot_id = $1`;
  }

  const result = await pool.query(`
    SELECT
      fz.*,
      ss.name AS spot_name, ss.slug AS spot_slug,
      ss.wave_type, ss.level AS spot_level
    FROM failure_zones fz
    JOIN surf_spots ss ON ss.id = fz.spot_id
    ${where}
    ORDER BY fz.damage_multiplier DESC
  `, params);
  return result.rows;
}

// Get the single highest-risk zone for a spot — used in booking flow risk warning.
async function getPrimaryZoneForSpot(spotId) {
  const result = await pool.query(`
    SELECT fz.*, ss.name AS spot_name
    FROM failure_zones fz
    JOIN surf_spots ss ON ss.id = fz.spot_id
    WHERE fz.spot_id = $1
    ORDER BY fz.damage_multiplier DESC
    LIMIT 1
  `, [spotId]);
  return result.rows[0] || null;
}

// Board compatibility check: given a board's construction + a spot_id, return risk level.
async function getBoardSpotRisk(boardId, spotId) {
  const result = await pool.query(`
    SELECT
      fz.zone_name,
      fz.damage_multiplier,
      fz.rider_level_warning,
      fz.dominant_damage_types,
      fz.worst_board_types,
      fz.recommended_board_types,
      g.fragility_profile,
      g.construction,
      -- Effective risk = spot multiplier × board fragility factor
      CASE
        WHEN g.fragility_profile = 'fragile' THEN fz.damage_multiplier * 1.5
        WHEN g.fragility_profile = 'rail-sensitive' THEN fz.damage_multiplier * 1.25
        WHEN g.fragility_profile = 'robust' THEN fz.damage_multiplier * 0.8
        ELSE fz.damage_multiplier
      END AS effective_risk
    FROM failure_zones fz
    LEFT JOIN board_genomes g ON g.board_id = $1
    WHERE fz.spot_id = $2
    ORDER BY effective_risk DESC
    LIMIT 1
  `, [boardId, spotId]);
  return result.rows[0] || null;
}

// Get all spots ranked by danger — used in host insights ("risky zones for your boards").
async function getSpotDangerRanking() {
  const result = await pool.query(`
    SELECT
      ss.id AS spot_id,
      ss.name AS spot_name,
      ss.slug,
      MAX(fz.damage_multiplier) AS max_multiplier,
      AVG(fz.damage_multiplier) AS avg_multiplier,
      SUM(fz.incident_count) AS total_incidents,
      AVG(fz.avg_repair_cost_cents) AS avg_repair_cost,
      MAX(fz.rider_level_warning) AS strictest_warning,
      array_agg(DISTINCT fz.zone_name) AS zones
    FROM failure_zones fz
    JOIN surf_spots ss ON ss.id = fz.spot_id
    GROUP BY ss.id, ss.name, ss.slug
    ORDER BY max_multiplier DESC
  `);
  return result.rows;
}

// Update a zone after real rental_events accumulate — called by the refresh endpoint.
async function refreshZoneFromEvents(spotId, zoneName, eventStats) {
  const { incident_count, avg_hidden_cost, weighted_damage_index } = eventStats;

  // Blend expert hypothesis with real data (weighted: 70% real if 20+ events, else 30% real)
  const result = await pool.query(`
    SELECT fz.*, fz.incident_count AS current_incidents
    FROM failure_zones fz
    WHERE fz.spot_id = $1 AND fz.zone_name = $2
  `, [spotId, zoneName]);

  if (!result.rows[0]) return null;
  const zone = result.rows[0];

  // If we have real data, update incident count and avg cost
  const newIncidentCount = (zone.current_incidents || 0) + (incident_count || 0);
  const newAvgCost = avg_hidden_cost || zone.avg_repair_cost_cents;

  // Blend damage_multiplier toward real data as events accumulate
  let newMultiplier = zone.damage_multiplier;
  const totalEvents = newIncidentCount;
  if (totalEvents >= 5 && weighted_damage_index) {
    const realMultiplier = 1.0 + (weighted_damage_index * 0.3);
    const weight = Math.min(totalEvents / 50, 1.0); // max blending at 50 events
    newMultiplier = parseFloat(
      (zone.damage_multiplier * (1 - weight) + realMultiplier * weight).toFixed(2)
    );
  }

  const updated = await pool.query(`
    UPDATE failure_zones
    SET
      damage_multiplier = $3,
      incident_count = $4,
      avg_repair_cost_cents = $5,
      data_source = CASE WHEN $4 >= 20 THEN 'hybrid' ELSE 'expert' END,
      last_updated = NOW()
    WHERE spot_id = $1 AND zone_name = $2
    RETURNING *
  `, [spotId, zoneName, newMultiplier, newIncidentCount, Math.round(newAvgCost || 0)]);

  return updated.rows[0];
}

// Recommend board types for a given spot — used in booking flow.
async function getBoardRecommendationsForSpot(spotId) {
  const result = await pool.query(`
    SELECT
      COALESCE(
        jsonb_agg(DISTINCT elem) FILTER (WHERE elem IS NOT NULL), '[]'::jsonb
      ) AS recommended_types,
      COALESCE(
        jsonb_agg(DISTINCT worst_elem) FILTER (WHERE worst_elem IS NOT NULL), '[]'::jsonb
      ) AS worst_types,
      AVG(damage_multiplier) AS avg_risk
    FROM failure_zones fz,
    jsonb_array_elements_text(fz.recommended_board_types) AS elem,
    jsonb_array_elements_text(fz.worst_board_types) AS worst_elem
    WHERE fz.spot_id = $1
  `, [spotId]);
  return result.rows[0];
}

module.exports = {
  getFailureZones,
  getPrimaryZoneForSpot,
  getBoardSpotRisk,
  getSpotDangerRanking,
  refreshZoneFromEvents,
  getBoardRecommendationsForSpot
};
