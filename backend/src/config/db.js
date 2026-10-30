// Oracle connection pool and transaction helpers (node-oracledb, Thin mode:
// no Oracle Client libraries required).
//
// Transaction contract: PL/SQL procedures never COMMIT. Every API write runs in
// withTransaction(), which commits once at the end or rolls back on any error.
import oracledb from 'oracledb';
import { env } from './env.js';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;            // explicit transactions only
oracledb.fetchArraySize = 200;

let pool = null;

export async function initPool() {
  if (pool) return pool;
  const options = {
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectString: env.DB_CONNECT_STRING,
    poolMin: env.DB_POOL_MIN,
    poolMax: env.DB_POOL_MAX,
    poolIncrement: 1,
    poolTimeout: 60,
    stmtCacheSize: 40,
  };
  // mTLS wallet (Autonomous Database "wallet" connections). For walletless TLS,
  // put the full connection descriptor in DB_CONNECT_STRING instead.
  if (env.DB_WALLET_DIR) {
    options.configDir = env.DB_WALLET_DIR;
    options.walletLocation = env.DB_WALLET_DIR;
    options.walletPassword = env.DB_WALLET_PASSWORD;
  }
  pool = await oracledb.createPool(options);
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.close(5);
    pool = null;
  }
}

export function isPoolReady() {
  return pool !== null;
}

async function acquire(actorId) {
  if (!pool) throw Object.assign(new Error('Database pool is not initialised'), { status: 503 });
  const conn = await pool.getConnection();
  // Read by audit triggers via SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER').
  conn.clientId = actorId ? String(actorId) : '';
  return conn;
}

/** Read-only work. Rolls back defensively before releasing the connection. */
export async function withConnection(actorId, fn) {
  const conn = await acquire(actorId);
  try {
    return await fn(conn);
  } finally {
    try { await conn.rollback(); } catch { /* ignore */ }
    await conn.close();
  }
}

/** One atomic unit of work: COMMIT on success, ROLLBACK on any error. */
export async function withTransaction(actorId, fn) {
  const conn = await acquire(actorId);
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection may be broken */ }
    throw err;
  } finally {
    await conn.close();
  }
}

// ---- result helpers --------------------------------------------------------

const camel = (key) => key.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

export function toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
}

/** Execute a statement and return camelCased rows. Always uses bind variables. */
export async function query(conn, sql, binds = {}, opts = {}) {
  const res = await conn.execute(sql, binds, opts);
  return (res.rows || []).map(toCamel);
}

export async function queryOne(conn, sql, binds = {}) {
  const rows = await query(conn, sql, binds);
  return rows[0] ?? null;
}

/** Call a PL/SQL function returning SYS_REFCURSOR and fetch every row. */
export async function fetchRefCursor(conn, plsqlCall, binds = {}) {
  const res = await conn.execute(
    `BEGIN :rc := ${plsqlCall}; END;`,
    { ...binds, rc: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR } },
  );
  const rs = res.outBinds.rc;
  try {
    const rows = await rs.getRows(); // all rows
    return rows.map(toCamel);
  } finally {
    await rs.close();
  }
}

export { oracledb };
