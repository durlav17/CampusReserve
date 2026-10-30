import { env } from './config/env.js';
import { initPool, closePool } from './config/db.js';
import { createApp } from './app.js';

async function main() {
  try {
    const pool = await initPool();
    const conn = await pool.getConnection();           // fail fast on bad credentials
    await conn.close();
    console.log(`Oracle pool ready (${env.DB_CONNECT_STRING})`);
  } catch (err) {
    // Start anyway so /api/health can report the problem; requests needing the
    // database will answer 503 until the service is restarted with valid settings.
    console.error('Could not create the Oracle connection pool:', err.message);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
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
