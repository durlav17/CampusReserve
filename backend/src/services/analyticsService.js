// Analytics: every number shown on the dashboard comes from these queries.
import { withConnection, withTransaction, query, fetchRefCursor, oracledb } from '../config/db.js';

const DATE = oracledb.DB_TYPE_DATE;
const d = (val) => ({ type: DATE, val });

export const summary = (uid) => withConnection(uid, async (c) =>
  (await fetchRefCursor(c, 'pkg_resource_analytics.dashboard_summary'))[0]);

export const trend = (uid, days) => withConnection(uid, (c) =>
  fetchRefCursor(c, 'pkg_resource_analytics.booking_trend(:days)', { days }));

export const topResources = (uid, from, to, limit) => withConnection(uid, (c) =>
  fetchRefCursor(c, 'pkg_resource_analytics.top_resources(:f, :t, :lim)', { f: d(from), t: d(to), lim: limit }));

export const departmentUsage = (uid, from, to) => withConnection(uid, (c) =>
  fetchRefCursor(c, 'pkg_resource_analytics.department_usage(:f, :t)', { f: d(from), t: d(to) }));

export const utilisation = (uid, from, to) => withConnection(uid, (c) =>
  fetchRefCursor(c, 'pkg_resource_analytics.resource_utilisation(:f, :t)', { f: d(from), t: d(to) }));

export const peakHours = (uid, from, to) => withConnection(uid, (c) =>
  fetchRefCursor(c, 'pkg_resource_analytics.peak_hours(:f, :t)', { f: d(from), t: d(to) }));

export const categoryBreakdown = (uid, from, to) => withConnection(uid, (c) =>
  query(c, `SELECT c.category_name,
                   COUNT(b.booking_id) AS bookings,
                   ROUND(NVL(SUM(fn_hours_between(b.start_time, b.end_time)), 0), 1) AS hours
              FROM resource_categories c
              JOIN resources r ON r.category_id = c.category_id
              LEFT JOIN bookings b ON b.resource_id = r.resource_id AND b.status = 'APPROVED'
                                  AND b.start_time >= CAST(:f AS TIMESTAMP)
                                  AND b.start_time <  CAST(:t AS TIMESTAMP)
             GROUP BY c.category_name
             ORDER BY hours DESC`, { f: d(from), t: d(to) }));

export function buildSnapshot(uid, from, to) {
  return withTransaction(uid, async (c) => {
    const res = await c.execute(
      'BEGIN pkg_resource_analytics.build_utilisation_snapshot(:f, :t, :n); END;',
      { f: d(from), t: d(to), n: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
    return res.outBinds.n;
  });
}

export const listSnapshots = (uid) => withConnection(uid, (c) =>
  query(c, `SELECT s.snapshot_id, s.period_start, s.period_end, s.booked_hours, s.available_hours,
                   s.utilisation_pct, s.booking_count, s.generated_at,
                   r.resource_code, r.resource_name
              FROM utilisation_snapshots s JOIN resources r ON r.resource_id = s.resource_id
             ORDER BY s.generated_at DESC, s.utilisation_pct DESC
             FETCH FIRST 200 ROWS ONLY`));
