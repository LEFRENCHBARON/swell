// What this module owns: all queries for board_genomes (SWELL_GENOME system).
// Does NOT handle HTTP, scoring logic, or board table mutations.
const pool = require('./index');

// Generate QG-XXXXXX identifier from board id
function makeGenomeId(boardId) {
  const hex = boardId.toString(16).toUpperCase().padStart(6, '0');
  return `QG-${hex}`;
}

// Compute ROI class from survival score and rental count
function computeRoiClass(survivalScore, rentalCount, avgRevenueCentsPerRental) {
  if (survivalScore >= 90 && rentalCount >= 10 && avgRevenueCentsPerRental >= 5000) return 'A+';
  if (survivalScore >= 75 && rentalCount >= 5) return 'A';
  if (survivalScore >= 50) return 'B';
  return 'C';
}

async function getGenomeByBoardId(boardId) {
  const result = await pool.query(`
    SELECT
      g.*,
      b.board_type, b.length_ft, b.condition, b.daily_price_cents,
      b.estimated_value_cents, b.title, b.photos,
      b.host_id,
      u.name AS host_name,
      s.name AS spot_name, s.slug AS spot_slug,
      COALESCE(AVG(r.rating), 0)::NUMERIC(3,1) AS avg_rating,
      COUNT(DISTINCT bk.id) AS confirmed_bookings
    FROM board_genomes g
    JOIN boards b ON b.id = g.board_id
    JOIN users u ON u.id = b.host_id
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    LEFT JOIN bookings bk ON bk.board_id = b.id AND bk.status = 'completed'
    WHERE g.board_id = $1
    GROUP BY g.id, b.board_type, b.length_ft, b.condition, b.daily_price_cents,
             b.estimated_value_cents, b.title, b.photos, b.host_id,
             u.name, s.name, s.slug
  `, [boardId]);
  return result.rows[0] || null;
}

async function getGenomeByGenomeId(genomeId) {
  const result = await pool.query(
    `SELECT g.board_id FROM board_genomes g WHERE g.genome_id = $1`,
    [genomeId]
  );
  if (!result.rows[0]) return null;
  return getGenomeByBoardId(result.rows[0].board_id);
}

// Upsert genome — creates on first board listing, updates on each rental completion.
async function upsertGenome(boardId, fields = {}) {
  const genomeId = makeGenomeId(boardId);

  const {
    shape, construction, shaper, brand_model, value_estimate,
    fragility_profile, preferred_wave_range,
    damage_history, profit_history,
    survival_score, rental_count, life_expectancy_estimate
  } = fields;

  // Compute ROI class
  const avgRevenue = profit_history?.length
    ? profit_history.reduce((sum, e) => sum + (e.amount_cents || 0), 0) / profit_history.length
    : 0;
  const roi_class = computeRoiClass(survival_score ?? 100, rental_count ?? 0, avgRevenue);

  const result = await pool.query(`
    INSERT INTO board_genomes (
      board_id, genome_id,
      shape, construction, shaper, brand_model, value_estimate,
      fragility_profile, preferred_wave_range,
      damage_history, profit_history,
      survival_score, rental_count, life_expectancy_estimate, roi_class,
      updated_at
    ) VALUES (
      $1, $2,
      $3, $4, $5, $6, $7,
      $8, $9,
      $10, $11,
      $12, $13, $14, $15,
      NOW()
    )
    ON CONFLICT (board_id) DO UPDATE SET
      shape = COALESCE($3, board_genomes.shape),
      construction = COALESCE($4, board_genomes.construction),
      shaper = COALESCE($5, board_genomes.shaper),
      brand_model = COALESCE($6, board_genomes.brand_model),
      value_estimate = COALESCE($7, board_genomes.value_estimate),
      fragility_profile = COALESCE($8, board_genomes.fragility_profile),
      preferred_wave_range = COALESCE($9, board_genomes.preferred_wave_range),
      damage_history = COALESCE($10::jsonb, board_genomes.damage_history),
      profit_history = COALESCE($11::jsonb, board_genomes.profit_history),
      survival_score = COALESCE($12, board_genomes.survival_score),
      rental_count = COALESCE($13, board_genomes.rental_count),
      life_expectancy_estimate = COALESCE($14, board_genomes.life_expectancy_estimate),
      roi_class = $15,
      updated_at = NOW()
    RETURNING *
  `, [
    boardId, genomeId,
    shape || null, construction || null, shaper || null, brand_model || null,
    value_estimate || null,
    fragility_profile || null, preferred_wave_range || null,
    damage_history ? JSON.stringify(damage_history) : null,
    profit_history ? JSON.stringify(profit_history) : null,
    survival_score ?? null, rental_count ?? null,
    life_expectancy_estimate ?? null,
    roi_class
  ]);

  return result.rows[0];
}

// Append a damage event to genome's history and recalculate survival score.
async function recordDamageEvent(boardId, damageEvent) {
  const genome = await getGenomeByBoardId(boardId);
  if (!genome) return null;

  const history = genome.damage_history || [];
  history.push({ ...damageEvent, timestamp: new Date().toISOString() });

  // Survival score drops based on severity
  const severity = { minor: 2, moderate: 5, significant: 12, major: 25 };
  const drop = severity[damageEvent.severity] || 5;
  const newSurvival = Math.max(0, (genome.survival_score || 100) - drop);

  // Life expectancy estimate decreases proportionally
  const newExpectancy = Math.max(0, Math.floor((newSurvival / 100) * 150));

  return upsertGenome(boardId, {
    damage_history: history,
    survival_score: newSurvival,
    life_expectancy_estimate: newExpectancy
  });
}

// Append a profit event and recalculate ROI class.
async function recordProfitEvent(boardId, profitEvent) {
  const genome = await getGenomeByBoardId(boardId);
  if (!genome) return null;

  const history = genome.profit_history || [];
  history.push({ ...profitEvent, timestamp: new Date().toISOString() });

  const newRentalCount = (genome.rental_count || 0) + 1;

  return upsertGenome(boardId, {
    profit_history: history,
    rental_count: newRentalCount
  });
}

// List all genomes for a host — used in host dashboard.
async function getGenomesByHost(hostId) {
  const result = await pool.query(`
    SELECT
      g.*,
      b.board_type, b.length_ft, b.title, b.daily_price_cents,
      b.is_listed,
      s.name AS spot_name
    FROM board_genomes g
    JOIN boards b ON b.id = g.board_id
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    WHERE b.host_id = $1
    ORDER BY g.roi_class ASC, g.survival_score DESC
  `, [hostId]);
  return result.rows;
}

// Auto-bootstrap genome for a board that doesn't have one yet.
async function ensureGenomeExists(boardId) {
  const existing = await pool.query('SELECT id FROM board_genomes WHERE board_id = $1', [boardId]);
  if (existing.rows.length > 0) return existing.rows[0];
  return upsertGenome(boardId, {
    survival_score: 100,
    rental_count: 0,
    life_expectancy_estimate: 100,
    roi_class: 'B'
  });
}

module.exports = {
  getGenomeByBoardId,
  getGenomeByGenomeId,
  upsertGenome,
  recordDamageEvent,
  recordProfitEvent,
  getGenomesByHost,
  ensureGenomeExists,
  makeGenomeId
};
