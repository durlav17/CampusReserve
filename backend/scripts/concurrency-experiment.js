#!/usr/bin/env node
// Experiment E2 - simultaneous booking attempts (TC-07).
//
// Opens N independent Oracle sessions that all try to book the SAME resource
// for the SAME interval at the same moment, in two modes:
//
//   naive  : "SELECT COUNT(*) ... then INSERT" with no lock, plus a short
//            DBMS_SESSION.SLEEP between check and insert to widen the race.
//   locked : the real SP_CREATE_BOOKING, which locks the resource row first.
//
// It prints and saves how many sessions succeeded in each mode and whether any
// overlapping rows were committed. Run it several times and report the
// observed numbers - do not copy numbers from the documentation.
//
//   cd backend
//   DB_PASSWORD=... DB_CONNECT_STRING=localhost:1521/FREEPDB1 \
//     node scripts/concurrency-experiment.js --sessions 10 --sleep 0.5
//
// All bookings created by the experiment are cancelled at the end.
import { mkdirSync, writeFileSync } from 'node:fs';
import { env } from '../src/config/env.js';
import { oracledb } from '../src/config/db.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const SESSIONS = Number(arg('sessions', 10));
const SLEEP = Number(arg('sleep', 0.5));
const RESOURCE_CODE = arg('resource', 'SJT-CR-305');

const connect = () => oracledb.getConnection({
  user: env.DB_USER, password: env.DB_PASSWORD, connectString: env.DB_CONNECT_STRING,
  ...(env.DB_WALLET_DIR ? { configDir: env.DB_WALLET_DIR, walletLocation: env.DB_WALLET_DIR, walletPassword: env.DB_WALLET_PASSWORD } : {}),
});

function slot(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function countOverlaps(conn, resourceId, start, end) {
  const r = await conn.execute(
    `SELECT COUNT(*) AS n FROM bookings
      WHERE resource_id = :rid AND status IN ('PENDING','APPROVED')
        AND start_time < :e AND end_time > :s`,
    { rid: resourceId, s: { type: oracledb.DB_TYPE_TIMESTAMP, val: start }, e: { type: oracledb.DB_TYPE_TIMESTAMP, val: end } },
    { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return r.rows[0].N;
}

async function runMode(mode, resourceId, users, start, end) {
  const conns = await Promise.all(Array.from({ length: SESSIONS }, connect));
  const t0 = Date.now();
  const results = await Promise.allSettled(conns.map(async (conn, i) => {
    const uid = users[i % users.length];
    if (mode === 'naive') {
      const r = await conn.execute(
        `DECLARE v_cnt NUMBER;
         BEGIN
           SELECT COUNT(*) INTO v_cnt FROM bookings
            WHERE resource_id = :rid AND status IN ('PENDING','APPROVED')
              AND start_time < :e AND end_time > :s;
           DBMS_SESSION.SLEEP(:sleep);
           IF v_cnt = 0 THEN
             INSERT INTO bookings (resource_id, requested_by, title, attendees, start_time, end_time, status)
             VALUES (:rid, :uid, :title, 5, :s, :e, 'APPROVED');
             :inserted := 1;
           ELSE
             :inserted := 0;
           END IF;
         END;`,
        {
          rid: resourceId, uid, title: `E2 naive ${i}`, sleep: SLEEP,
          s: { type: oracledb.DB_TYPE_TIMESTAMP, val: start }, e: { type: oracledb.DB_TYPE_TIMESTAMP, val: end },
          inserted: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        });
      await conn.commit();
      return r.outBinds.inserted === 1 ? 'inserted' : 'saw-conflict';
    }
    const r = await conn.execute(
      `BEGIN sp_create_booking(:rid, :uid, :title, NULL, 5, :s, :e, NULL, :id, :st, :dup); END;`,
      {
        rid: resourceId, uid, title: `E2 locked ${i}`,
        s: { type: oracledb.DB_TYPE_TIMESTAMP, val: start }, e: { type: oracledb.DB_TYPE_TIMESTAMP, val: end },
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        st: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 12 },
        dup: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      });
    await conn.commit();
    return `inserted #${r.outBinds.id}`;
  }));
  const elapsedMs = Date.now() - t0;
  await Promise.all(conns.map(async (c) => { try { await c.rollback(); await c.close(); } catch { /* ignore */ } }));

  const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : `error: ${String(r.reason?.message).split('\n')[0]}`));
  const succeeded = outcomes.filter((o) => o.startsWith('inserted')).length;
  return { mode, sessions: SESSIONS, succeeded, failed: SESSIONS - succeeded, elapsedMs, outcomes };
}

async function main() {
  const admin = await connect();
  try {
    const res = await admin.execute('SELECT resource_id FROM resources WHERE resource_code = :c', { c: RESOURCE_CODE });
    if (!res.rows.length) throw new Error(`Resource ${RESOURCE_CODE} not found - run the seed script first.`);
    const resourceId = res.rows[0][0];
    const users = (await admin.execute(
      `SELECT user_id FROM users WHERE role_id = 1 AND is_active = 'Y' ORDER BY user_id`)).rows.map((r) => r[0]);

    // Separate, empty slots for each mode, 50+ days ahead (outside seeded data).
    const naiveSlot = [slot(50, 10), slot(50, 11)];
    const lockedSlot = [slot(51, 10), slot(51, 11)];
    if (await countOverlaps(admin, resourceId, ...naiveSlot) || await countOverlaps(admin, resourceId, ...lockedSlot)) {
      throw new Error('Experiment slots are not empty; cancel earlier experiment bookings first.');
    }

    console.log(`Experiment E2: ${SESSIONS} concurrent sessions, resource ${RESOURCE_CODE} (id ${resourceId}), sleep ${SLEEP}s`);
    const naive = await runMode('naive', resourceId, users, ...naiveSlot);
    naive.overlappingRowsCommitted = await countOverlaps(admin, resourceId, ...naiveSlot);
    const locked = await runMode('locked', resourceId, users, ...lockedSlot);
    locked.overlappingRowsCommitted = await countOverlaps(admin, resourceId, ...lockedSlot);

    for (const r of [naive, locked]) {
      console.log(`\n[${r.mode}] succeeded=${r.succeeded} failed=${r.failed} live rows in slot=${r.overlappingRowsCommitted} elapsed=${r.elapsedMs} ms`);
      r.outcomes.forEach((o, i) => console.log(`  session ${String(i).padStart(2)}: ${o}`));
    }

    const report = {
      experiment: 'E2 simultaneous booking attempts',
      runAt: new Date().toISOString(),
      database: env.DB_CONNECT_STRING,
      resource: RESOURCE_CODE, sessions: SESSIONS, sleepSeconds: SLEEP,
      results: [naive, locked],
    };
    mkdirSync('experiment-results', { recursive: true });
    const file = `experiment-results/concurrency-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\nSaved ${file}`);

    // Clean up: cancel every booking created by this run.
    await admin.execute(
      `UPDATE bookings SET status = 'CANCELLED', cancel_reason = 'E2 experiment cleanup'
        WHERE title LIKE 'E2 %' AND status IN ('PENDING','APPROVED')`);
    await admin.commit();
  } finally {
    await admin.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
