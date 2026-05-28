// What this module owns: partners table queries (create, fetch, status updates).
// Does NOT handle HTTP, auth, or email delivery — that belongs in routes/partners.js.
const pool = require('./index');

/**
 * Insert a new partner registration request. Returns the saved row.
 */
async function createPartner({ name, type, location, email, phone, fleet_estimate, website, message }) {
  const result = await pool.query(`
    INSERT INTO partners (name, type, location, email, phone, fleet_estimate, website, message)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [name, type, location, email, phone, fleet_estimate || null, website || null, message || null]);
  return result.rows[0];
}

/**
 * Returns all partner registrations ordered by most recent first.
 * Admin use only — not exposed to public API.
 */
async function getAllPartners(status = null) {
  if (status) {
    const result = await pool.query(
      `SELECT * FROM partners WHERE status = $1 ORDER BY created_at DESC`,
      [status]
    );
    return result.rows;
  }
  const result = await pool.query(`SELECT * FROM partners ORDER BY created_at DESC`);
  return result.rows;
}

/**
 * Update partner status (pending → approved → active).
 */
async function updatePartnerStatus(id, status) {
  const result = await pool.query(
    `UPDATE partners SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return result.rows[0];
}

module.exports = { createPartner, getAllPartners, updatePartnerStatus };
