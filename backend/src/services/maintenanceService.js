import { withConnection, withTransaction, query, oracledb } from '../config/db.js';

export function listMaintenance(user, { status, priority, resourceId, mine, limit, offset }) {
  return withConnection(user.userId, async (conn) => {
    const where = ['1 = 1'];
    const binds = { limit, offset };
    if (mine) { where.push('reporter_id = :userId'); binds.userId = user.userId; }
    if (status) { where.push('status = :status'); binds.status = status; }
    if (priority) { where.push('priority = :priority'); binds.priority = priority; }
    if (resourceId) { where.push('resource_id = :rid'); binds.rid = resourceId; }
    const rows = await query(conn,
      `SELECT v.*, COUNT(*) OVER () AS total_count
         FROM v_maintenance_dashboard v
        WHERE ${where.join(' AND ')}
        ORDER BY CASE WHEN status IN ('OPEN','IN_PROGRESS') THEN 0 ELSE 1 END, priority_rank, created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, binds);
    return { total: rows[0]?.totalCount ?? 0, items: rows.map(({ totalCount, ...r }) => r) };
  });
}

export function submitMaintenance(user, m) {
  return withTransaction(user.userId, async (conn) => {
    const res = await conn.execute(
      'BEGIN sp_submit_maintenance(:rid, :uid, :title, :descr, :priority, :blocks, :id); END;',
      {
        rid: m.resourceId, uid: user.userId, title: m.title, descr: m.description ?? null,
        priority: m.priority, blocks: m.blocksBooking ? 'Y' : 'N',
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      });
    return res.outBinds.id;
  });
}

export function updateMaintenanceStatus(user, requestId, { status, assignedTo, notes }) {
  return withTransaction(user.userId, (conn) =>
    conn.execute('BEGIN sp_update_maintenance_status(:id, :actor, :status, :assignee, :notes); END;',
      { id: requestId, actor: user.userId, status, assignee: assignedTo ?? null, notes: notes ?? null }));
}

export function escalateStale(user, days) {
  return withTransaction(user.userId, async (conn) => {
    const res = await conn.execute(
      'BEGIN pkg_resource_analytics.escalate_stale_maintenance(:days, :n); END;',
      { days, n: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
    return res.outBinds.n;
  });
}

export function listAssignees(user) {
  return withConnection(user.userId, (conn) =>
    query(conn, `SELECT u.user_id, u.full_name, r.role_code
                   FROM users u JOIN roles r ON r.role_id = u.role_id
                  WHERE r.can_approve = 'Y' AND u.is_active = 'Y' ORDER BY u.full_name`));
}
