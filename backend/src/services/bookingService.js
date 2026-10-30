// Bookings: every write goes through a stored procedure inside one transaction.
import { withConnection, withTransaction, query, queryOne, fetchRefCursor, oracledb } from '../config/db.js';

const TS = oracledb.DB_TYPE_TIMESTAMP;
const out = (type, maxSize) => ({ dir: oracledb.BIND_OUT, type, ...(maxSize ? { maxSize } : {}) });

export function createBooking(user, b, requestKey) {
  return withTransaction(user.userId, async (conn) => {
    const res = await conn.execute(
      `BEGIN
         sp_create_booking(:rid, :uid, :title, :purpose, :attendees, :startTs, :endTs, :reqKey,
                           :bookingId, :status, :duplicate);
       END;`,
      {
        rid: b.resourceId,
        uid: user.userId,
        title: b.title,
        purpose: b.purpose ?? null,
        attendees: b.attendees,
        startTs: { type: TS, val: b.start },
        endTs: { type: TS, val: b.end },
        reqKey: requestKey ?? null,
        bookingId: out(oracledb.NUMBER),
        status: out(oracledb.STRING, 12),
        duplicate: out(oracledb.NUMBER),
      },
    );
    const { bookingId, status, duplicate } = res.outBinds;
    return { bookingId, status, duplicate: duplicate === 1 };
  });
}

export function decideBooking(user, bookingId, decision, remarks) {
  return withTransaction(user.userId, (conn) =>
    conn.execute('BEGIN sp_decide_booking(:id, :approver, :decision, :remarks); END;',
      { id: bookingId, approver: user.userId, decision, remarks: remarks ?? null }));
}

export function cancelBooking(user, bookingId, reason) {
  return withTransaction(user.userId, (conn) =>
    conn.execute('BEGIN sp_cancel_booking(:id, :uid, :reason); END;',
      { id: bookingId, uid: user.userId, reason: reason ?? null }));
}

/**
 * scope 'mine' = the caller's bookings; 'all' = everything (approvers only,
 * enforced by the route).
 */
export function listBookings(user, { scope, status, from, to, resourceId, limit, offset }) {
  return withConnection(user.userId, async (conn) => {
    const where = ['1 = 1'];
    const binds = { limit, offset };
    if (scope !== 'all') { where.push('requester_id = :userId'); binds.userId = user.userId; }
    if (status) { where.push('status = :status'); binds.status = status; }
    if (resourceId) { where.push('resource_id = :rid'); binds.rid = resourceId; }
    if (from) { where.push('end_time > :fromTs'); binds.fromTs = { type: TS, val: from }; }
    if (to) { where.push('start_time < :toTs'); binds.toTs = { type: TS, val: to }; }
    const rows = await query(conn,
      `SELECT v.*, COUNT(*) OVER () AS total_count
         FROM v_booking_details v
        WHERE ${where.join(' AND ')}
        ORDER BY start_time DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, binds);
    return { total: rows[0]?.totalCount ?? 0, items: rows.map(({ totalCount, ...r }) => r) };
  });
}

export function getBooking(user, bookingId) {
  return withConnection(user.userId, async (conn) => {
    const booking = await queryOne(conn,
      `SELECT v.*, r.managed_by_dept
         FROM v_booking_details v JOIN resources r ON r.resource_id = v.resource_id
        WHERE v.booking_id = :id`, { id: bookingId });
    if (!booking) return null;
    const history = await query(conn,
      `SELECT a.audit_id, a.action, a.old_status, a.new_status, a.changed_at, a.details,
              u.full_name AS changed_by_name
         FROM audit_logs a LEFT JOIN users u ON u.user_id = a.changed_by
        WHERE a.table_name = 'BOOKINGS' AND a.record_id = :id
        ORDER BY a.audit_id`, { id: bookingId });
    return { ...booking, history };
  });
}

export function pendingForApprover(user) {
  return withConnection(user.userId, (conn) =>
    fetchRefCursor(conn, 'pkg_campus_reservations.pending_for_approver(:uid)', { uid: user.userId }));
}

export function sendPendingDigest(user) {
  return withTransaction(user.userId, async (conn) => {
    const res = await conn.execute(
      'BEGIN pkg_campus_reservations.send_pending_digest(:uid, :n); END;',
      { uid: user.userId, n: out(oracledb.NUMBER) });
    return res.outBinds.n;
  });
}

export function expireStalePending(user) {
  return withTransaction(user.userId, async (conn) => {
    const res = await conn.execute(
      'BEGIN pkg_campus_reservations.expire_stale_pending(:uid, :n); END;',
      { uid: user.userId, n: out(oracledb.NUMBER) });
    return res.outBinds.n;
  });
}
