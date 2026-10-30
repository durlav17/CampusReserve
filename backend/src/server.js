import { env } from './config/env.js';
import { initPool, closePool } from './config/db.js';
import { createApp } from './app.js';

// Retrying these only burns failed-login attempts and can lock the account.
const CREDENTIAL_ERRORS = new Set([1017, 28000, 28001]);

async function main() {
  try {
    if (!env.DB_PASSWORD) throw new Error('DB_PASSWORD is not set; add it to backend/.env.');
    const pool = await initPool();
    const conn = await pool.getConnection();           // fail fast on bad credentials
    await conn.close();
    console.log(`Oracle pool ready (${env.DB_CONNECT_STRING})`);
  } catch (err) {
    // Start anyway so /api/health can report the problem; requests needing the
    // database will answer 503 until the service is restarted with valid settings.
    console.error('Could not create the Oracle connection pool:', err.message);
    if (CREDENTIAL_ERRORS.has(err.errorNum)) await closePool().catch(() => {});
  }

  const app = createApp();
  const server = app.listen(env.PORT, (err) => {
    // Express 5 also reports listen failures (such as EADDRINUSE) through this callback.
    if (err) {
      console.error(`Could not listen on port ${env.PORT}: ${err.message}`);
      process.exit(1);
    }
    console.log(`CampusReserve API listening on port ${env.PORT} (${env.NODE_ENV}, TZ=${env.TZ})`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await closePool().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
