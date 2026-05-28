// What this module owns: all queries for host_metrics (HOST_EVOLUTION_ENGINE).
// Does NOT handle HTTP, notifications, or external scoring signals.
const pool = require('./index');

// Tier thresholds — defined once, referenced by compute and queries.
const TIER_THRESHOLDS = {
  ALPHA_SHAPER:  { minTrust: 90, minBoardQuality: 4.8, minCommunityPull: 1000 },
  LOCAL_ICON:    { minTrust: 80, minRepeatRentalsPct: 30 },
  PREMIUM_HOST:  { minTrust: 70 },
  GROWTH_HOST:   { minTrust: 50 },
  AT_RISK:       { maxTrust: 30, maxIncidentRate: 80, maxResponseTime: 2880 } // 48h in minutes
};

function computeTier(m) {
  const t = TIER_THRESHOLDS;
  if (m.trust_score < t.AT_RISK.maxTrust ||
      m.low_incident_rate_pct < (100 - t.AT_RISK.maxIncidentRate) ||
      m.response_time_avg_min > t.AT_RISK.maxResponseTime) {
    return 'AT_RISK';
  }
  if (m.trust_score >= t.ALPHA_SHAPER.minTrust &&
      m.board_quality_avg >= t.ALPHA_SHAPER.minBoardQuality &&
      m.community_pull >= t.ALPHA_SHAPER.minCommunityPull) {
    return 'ALPHA_SHAPER';
  }
  if (m.trust_score >= t.LOCAL_ICON.minTrust &&
      m.repeat_rentals_pct >= t.LOCAL_ICON.minRepeatRentalsPct) {
    return 'LOCAL_ICON';
  }
  if (m.trust_score >= t.PREMIUM_HOST.minTrust) return 'PREMIUM_HOST';
  if (m.trust_score >= t.GROWTH_HOST.minTrust) return 'GROWTH_HOST';
  return 'AT_RISK';
}

function computeNextTierRequirements(tier, m) {
  const reqs = [];
  if (tier === 'GROWTH_HOST') {
    if (m.trust_score < 70) reqs.push(`Trust score ${m.trust_score.toFixed(0)}/70 — improve response time + verification`);
    if (m.board_quality_avg < 4.0) reqs.push(`Board quality ${m.board_quality_avg.toFixed(1)}/4.0 — maintain boards, respond to feedback`);
  }
  if (tier === 'PREMIUM_HOST') {
    if (m.trust_score < 80) reqs.push(`Trust score ${m.trust_score.toFixed(0)}/80`);
    if (m.repeat_rentals_pct < 30) reqs.push(`Repeat renter rate ${m.repeat_rentals_pct.toFixed(0)}%/30%`);
  }
  if (tier === 'LOCAL_ICON') {
    if (m.trust_score < 90) reqs.push(`Trust score ${m.trust_score.toFixed(0)}/90`);
    if (m.board_quality_avg < 4.8) reqs.push(`Board quality ${m.board_quality_avg.toFixed(1)}/4.8`);
    if (m.community_pull < 1000) reqs.push(`Community pull ${m.community_pull}/1000 (referrals, repeat renters)`);
  }
  if (tier === 'ALPHA_SHAPER') {
    reqs.push('You are at the top tier — maintain quality and grow your network');
  }
  if (tier === 'AT_RISK') {
    if (m.trust_score < 30) reqs.push('Critical: trust score below 30 — respond faster, get verified');
    if (m.low_incident_rate_pct < 80) reqs.push('Critical: incident rate too high — review board condition');
    if (m.response_time_avg_min > 2880) reqs.push('Critical: response time >48h — respond to inquiries faster');
  }
  return reqs;
}

// Compute trust score from raw host data.
// Formula: weighted sum of multiple signals, capped 0-100.
function computeTrustScore(data) {
  let score = 50; // base

  // Identity verification: +20 if verified
  if (data.identity_status === 'verified') score += 20;
  else if (data.identity_status === 'pending') score += 5;

  // Board quality: +0 to +15 (quality above 3.0)
  const qualityBonus = Math.min(15, Math.max(0, (data.board_quality_avg - 3.0) * 10));
  score += qualityBonus;

  // Response time: +0 to +10 (under 30min = max bonus)
  if (data.response_time_avg_min <= 30) score += 10;
  else if (data.response_time_avg_min <= 120) score += 7;
  else if (data.response_time_avg_min <= 480) score += 3;
  else if (data.response_time_avg_min > 2880) score -= 10;

  // Incident rate: -0 to -20 (high incident rate = big penalty)
  const incidentPenalty = Math.max(0, (100 - data.low_incident_rate_pct) * 0.2);
  score -= incidentPenalty;

  // Rental volume: small bonus for experienced hosts
  if (data.total_rentals >= 20) score += 5;
  else if (data.total_rentals >= 5) score += 2;

  return Math.min(100, Math.max(0, Math.round(score * 100) / 100));
}

// Upsert host metrics — call after each booking completion or review.
async function upsertHostMetrics(hostId, rawData = {}) {
  // First read current metrics to detect trends
  const existing = await pool.query(
    'SELECT trust_score, tier FROM host_metrics WHERE host_id = $1',
    [hostId]
  );
  const prev = existing.rows[0];

  const trustScore = computeTrustScore(rawData);
  const tier = computeTier({
    trust_score: trustScore,
    board_quality_avg: rawData.board_quality_avg || 0,
    repeat_rentals_pct: rawData.repeat_rentals_pct || 0,
    low_incident_rate_pct: rawData.low_incident_rate_pct || 100,
    response_time_avg_min: rawData.response_time_avg_min || 60,
    community_pull: rawData.community_pull || 0
  });

  const nextTierReqs = computeNextTierRequirements(tier, {
    trust_score: trustScore,
    board_quality_avg: rawData.board_quality_avg || 0,
    repeat_rentals_pct: rawData.repeat_rentals_pct || 0,
    low_incident_rate_pct: rawData.low_incident_rate_pct || 100,
    response_time_avg_min: rawData.response_time_avg_min || 60,
    community_pull: rawData.community_pull || 0
  });

  // Determine trend: compare to previous trust score
  let trend = 'stable';
  if (prev) {
    const delta = trustScore - parseFloat(prev.trust_score);
    if (delta > 5) trend = 'rising';
    else if (delta < -5) trend = 'declining';
  }

  const result = await pool.query(`
    INSERT INTO host_metrics (
      host_id, trust_score, board_quality_avg, repeat_rentals_pct,
      low_incident_rate_pct, response_time_avg_min, payout_completion_rate,
      total_rentals, total_revenue_cents, active_boards, community_pull,
      tier, evolution_trend, next_tier_requirements,
      prev_trust_score, prev_tier, metrics_updated_at, updated_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14::jsonb,
      $15, $16, NOW(), NOW()
    )
    ON CONFLICT (host_id) DO UPDATE SET
      trust_score = $2,
      board_quality_avg = $3,
      repeat_rentals_pct = $4,
      low_incident_rate_pct = $5,
      response_time_avg_min = $6,
      payout_completion_rate = $7,
      total_rentals = $8,
      total_revenue_cents = $9,
      active_boards = $10,
      community_pull = $11,
      tier = $12,
      evolution_trend = $13,
      next_tier_requirements = $14::jsonb,
      prev_trust_score = (SELECT trust_score FROM host_metrics WHERE host_id = $1),
      prev_tier = (SELECT tier FROM host_metrics WHERE host_id = $1),
      metrics_updated_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `, [
    hostId,
    trustScore,
    rawData.board_quality_avg || 0,
    rawData.repeat_rentals_pct || 0,
    rawData.low_incident_rate_pct || 100,
    rawData.response_time_avg_min || 60,
    rawData.payout_completion_rate || 100,
    rawData.total_rentals || 0,
    rawData.total_revenue_cents || 0,
    rawData.active_boards || 0,
    rawData.community_pull || 0,
    tier,
    trend,
    JSON.stringify(nextTierReqs),
    prev?.trust_score || null,
    prev?.tier || null
  ]);

  return result.rows[0];
}

// Compute and upsert host metrics from live DB data — self-contained refresh.
async function refreshHostMetrics(hostId) {
  const result = await pool.query(`
    SELECT
      u.identity_status,
      COUNT(DISTINCT b.id) FILTER (WHERE b.is_listed = true) AS active_boards,
      COALESCE(AVG(r.rating) FILTER (WHERE r.published_at IS NOT NULL), 0) AS board_quality_avg,
      COUNT(bk.id) FILTER (WHERE bk.status = 'completed') AS total_rentals,
      COALESCE(SUM(bk.total_cents) FILTER (WHERE bk.status = 'completed'), 0) AS total_revenue_cents,
      -- Incident rate from rental_events
      COALESCE(
        100 - (
          COUNT(re.id) FILTER (WHERE re.incident_reported = true)::NUMERIC /
          NULLIF(COUNT(re.id), 0) * 100
        ), 100
      ) AS low_incident_rate_pct
    FROM users u
    LEFT JOIN boards b ON b.host_id = u.id
    LEFT JOIN bookings bk ON bk.board_id = b.id
    LEFT JOIN reviews r ON r.board_id = b.id AND r.reviewer_role = 'renter'
    LEFT JOIN rental_events re ON re.board_id = b.id
    WHERE u.id = $1
    GROUP BY u.id, u.identity_status
  `, [hostId]);

  if (!result.rows[0]) return null;
  const data = result.rows[0];

  // Repeat renter rate: renters who booked more than once with this host
  const repeatResult = await pool.query(`
    SELECT
      ROUND(
        COUNT(DISTINCT sub.renter_id) FILTER (WHERE sub.cnt > 1)::NUMERIC /
        NULLIF(COUNT(DISTINCT sub.renter_id), 0) * 100,
      1) AS repeat_pct
    FROM (
      SELECT bk.renter_id, COUNT(*) AS cnt
      FROM bookings bk
      JOIN boards b ON b.id = bk.board_id
      WHERE b.host_id = $1 AND bk.status = 'completed'
      GROUP BY bk.renter_id
    ) sub
  `, [hostId]);

  return upsertHostMetrics(hostId, {
    ...data,
    repeat_rentals_pct: parseFloat(repeatResult.rows[0]?.repeat_pct || 0),
    identity_status: data.identity_status,
    response_time_avg_min: 60 // default; would be pulled from message timestamps in V2
  });
}

// Get metrics for a specific host.
async function getHostMetrics(hostId) {
  const result = await pool.query(`
    SELECT hm.*, u.name AS host_name, u.avatar_url, u.identity_status
    FROM host_metrics hm
    JOIN users u ON u.id = hm.host_id
    WHERE hm.host_id = $1
  `, [hostId]);
  return result.rows[0] || null;
}

// Admin: list all hosts by tier — for partnership and risk management.
async function listHostsByTier(tier = null, limit = 50) {
  const params = [];
  let where = '';
  if (tier) {
    params.push(tier);
    where = `WHERE hm.tier = $1`;
  }
  params.push(limit);

  const result = await pool.query(`
    SELECT
      hm.*,
      u.name AS host_name,
      u.email AS host_email,
      u.avatar_url,
      u.identity_status,
      u.created_at AS member_since
    FROM host_metrics hm
    JOIN users u ON u.id = hm.host_id
    ${where}
    ORDER BY hm.trust_score DESC
    LIMIT $${params.length}
  `, params);
  return result.rows;
}

// Admin: get full tier distribution.
async function getTierDistribution() {
  const result = await pool.query(`
    SELECT tier, COUNT(*) AS host_count, AVG(trust_score) AS avg_trust
    FROM host_metrics
    GROUP BY tier
    ORDER BY avg_trust DESC
  `);
  return result.rows;
}

module.exports = {
  upsertHostMetrics,
  refreshHostMetrics,
  getHostMetrics,
  listHostsByTier,
  getTierDistribution,
  computeTier,
  computeTrustScore,
  TIER_THRESHOLDS
};
