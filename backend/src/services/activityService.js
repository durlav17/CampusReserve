// Audit log (read-only; written exclusively by triggers) and notifications.
import { withConnection, withTransaction, query } from '../config/db.js';

export function listAudit(uid, { table, recordId, action, limit, offset }) {
  return withConnection(uid, async (c) => {
    const where = ['1 = 1'];
    const binds = { limit, offset };
    if (table) { where.push('a.table_name = :tbl'); binds.tbl = table; }
    if (recordId) { where.push('a.record_id = :rid'); binds.rid = recordId; }
    if (action) { where.push('a.action = :act'); binds.act = action; }
    const rows = await query(c,
      `SELECT a.audit_id, a.table_name, a.record_id, a.action, a.old_status, a.new_status,
              a.changed_at, a.details, u.full_name AS changed_by_name, COUNT(*) OVER () AS total_count
         FROM audit_logs a LEFT JOIN users u ON u.user_id = a.changed_by
        WHERE ${where.join(' AND ')}
        ORDER BY a.audit_id DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, binds);
    return { total: rows[0]?.totalCount ?? 0, items: rows.map(({ totalCount, ...r }) => r) };
  });
}

export const listNotifications = (uid) => withConnection(uid, (c) =>
  query(c, `SELECT notification_id, notif_type, title, message, booking_id, is_read, created_at
              FROM notifications WHERE user_id = :uid
             ORDER BY created_at DESC FETCH FIRST 50 ROWS ONLY`, { uid }));

export const markRead = (uid, id) => withTransaction(uid, (c) =>
  c.execute(`UPDATE notifications SET is_read = 'Y' WHERE notification_id = :id AND user_id = :uid`,
    { id, uid }));

export const markAllRead = (uid) => withTransaction(uid, (c) =>
  c.execute(`UPDATE notifications SET is_read = 'Y' WHERE user_id = :uid AND is_read = 'N'`, { uid }));
