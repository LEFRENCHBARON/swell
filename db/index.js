// What this module owns: single Pool instance for the entire app.
// Does NOT execute queries directly — that belongs to entity-specific db files.
const { Pool } = require('pg');
const logger = require('../lib/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 5,                        // Neon free tier — rester sous la limite de connexions simultanées
  connectionTimeoutMillis: 5000, // Fail fast plutôt que d'attendre indéfiniment (évite les hangs 40-70 s)
  query_timeout: 8000,           // Abort côté Node si Neon ne répond pas dans les 8 s (cold start PgBouncer)
  idleTimeoutMillis: 30000,      // Libère les connexions inactives après 30 s
  keepAlive: true,               // TCP keepalive — détecte les connexions mortes côté Neon
  keepAliveInitialDelayMillis: 10000, // 10 s avant le premier keepalive probe
  // statement_timeout côté serveur (7 s < query_timeout 8 s) : Neon tue la requête
  // AVANT que Node l'abandonne, donc la connexion poolée est immédiatement réutilisable
  // au lieu de rester occupée par une requête zombie — c'est ça qui ré-épuisait le pool.
  // Passé en paramètre de démarrage via `options` (et non SET) car PgBouncer en mode
  // transaction ne persiste pas les SET, mais propage bien les startup parameters.
  options: '-c statement_timeout=7000',
});

// Without this handler, an error on an idle client (e.g. Neon suspending the
// connection after inactivity) becomes an uncaught exception that kills the process.
pool.on('error', (err) => {
  logger.error({ err: err.message }, 'pg pool idle client error');
});

module.exports = pool;
