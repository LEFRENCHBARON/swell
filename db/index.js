// What this module owns: single Pool instance for the entire app.
// Does NOT execute queries directly — that belongs to entity-specific db files.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

module.exports = pool;
