// What this module owns: single Pool instance for the entire app.
// Does NOT execute queries directly — that belongs to entity-specific db files.
const { Pool } = require('pg');
const logger = require('../lib/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Without this handler, an error on an idle client (e.g. Neon suspending the
// connection after inactivity) becomes an uncaught exception that kills the process.
pool.on('error', (err) => {
  logger.error({ err: err.message }, 'pg pool idle client error');
});

module.exports = pool;
