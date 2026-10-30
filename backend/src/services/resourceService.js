import { withConnection, withTransaction, query, queryOne, fetchRefCursor, oracledb } from '../config/db.js';

const TS = { type: oracledb.DB_TYPE_TIMESTAMP };

export function listResources({ q, categoryId, buildingId, status, minCapacity }) {
  return withConnection(null, (conn) => {
    const where = ['1 = 1'];
    const binds = {};
    if (q) {
      where.push('(LOWER(resource_name) LIKE :q OR LOWER(resource_code) LIKE :q OR LOWER(description) LIKE :q)');
      binds.q = `%${q.toLowerCase()}%`;
    }
    if (categoryId) { where.push('category_id = :categoryId'); binds.categoryId = categoryId; }
    if (buildingId) { where.push('building_id = :buildingId'); binds.buildingId = buildingId; }
    if (status) { where.push('status = :status'); binds.status = status; }
    if (minCapacity) { where.push('capacity >= :minCapacity'); binds.minCapacity = minCapacity; }
    return query(conn,
      `SELECT * FROM v_resource_catalog WHERE ${where.join(' AND ')}
        ORDER BY CASE status WHEN 'AVAILABLE' THEN 0 ELSE 1 END, category_name, resource_name`, binds);
  });
}

export function getResource(resourceId) {
  return withConnection(null, async (conn) => {
    const resource = await queryOne(conn, 'SELECT * FROM v_resource_catalog WHERE resource_id = :id',
      { id: resourceId });
    if (!resource) return null;
    const [util] = await query(conn,
      `SELECT fn_resource_utilisation(:id, TRUNC(SYSDATE) - 30, TRUNC(SYSDATE)) AS utilisation_30d FROM dual`,
      { id: resourceId });
    const upcoming = await query(conn,
      `SELECT booking_id, title, status, start_time, end_time, requester_name
         FROM v_booking_details
        WHERE resource_id = :id AND status IN ('PENDING','APPROVED') AND end_time > SYSTIMESTAMP
        ORDER BY start_time FETCH FIRST 8 ROWS ONLY`, { id: resourceId });
    const maintenance = await query(conn,
      `SELECT request_id, title, priority, status, created_at
         FROM maintenance_requests
        WHERE resource_id = :id AND status IN ('OPEN','IN_PROGRESS')
        ORDER BY created_at DESC`, { id: resourceId });
    return { ...resource, utilisation30d: util.utilisation30d, upcoming, openTickets: maintenance };
  });
}

export function getSchedule(resourceId, from, to) {
  return withConnection(null, (conn) =>
    fetchRefCursor(conn, 'pkg_campus_reservations.resource_schedule(:rid, :fromTs, :toTs)', {
      rid: resourceId, fromTs: { ...TS, val: from }, toTs: { ...TS, val: to },
    }));
}

/** Calls the PIPELINED table function from plain SQL. */
export function getDaySlots(resourceId, day, slotMinutes) {
  return withConnection(null, (conn) =>
    query(conn,
      `SELECT slot_start, slot_end, slot_state, booking_id
         FROM TABLE(pkg_campus_reservations.day_slots(:rid, TO_DATE(:day, 'YYYY-MM-DD'), :mins))`,
      { rid: resourceId, day, mins: slotMinutes }));
}

export function checkAvailability(resourceId, start, end) {
  return withConnection(null, async (conn) => {
    const row = await queryOne(conn,
      'SELECT fn_resource_availability(:rid, :s, :e) AS verdict FROM dual',
      { rid: resourceId, s: { ...TS, val: start }, e: { ...TS, val: end } });
    return row.verdict;
  });
}

export function createResource(actorId, r) {
  return withTransaction(actorId, async (conn) => {
    const res = await conn.execute(
      `INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept,
                              floor_no, room_no, capacity, opens_at_hour, closes_at_hour,
                              description, features_json)
       VALUES (:code, :name, :categoryId, :buildingId, :deptId, :floorNo, :roomNo, :capacity,
               :opensAt, :closesAt, :description, :features)
       RETURNING resource_id INTO :id`,
      {
        code: r.resourceCode, name: r.resourceName, categoryId: r.categoryId,
        buildingId: r.buildingId ?? null, deptId: r.managedByDept, floorNo: r.floorNo ?? null,
        roomNo: r.roomNo ?? null, capacity: r.capacity, opensAt: r.opensAtHour, closesAt: r.closesAtHour,
        description: r.description ?? null,
        features: r.features ? JSON.stringify(r.features) : null,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );
    return res.outBinds.id[0];
  });
}

const UPDATABLE = {
  resourceName: 'resource_name', capacity: 'capacity', opensAtHour: 'opens_at_hour',
  closesAtHour: 'closes_at_hour', description: 'description', status: 'status',
  buildingId: 'building_id', floorNo: 'floor_no', roomNo: 'room_no',
};

export function updateResource(actorId, resourceId, patch) {
  return withTransaction(actorId, async (conn) => {
    // Column names come from the fixed whitelist above, values are bound.
    const sets = [];
    const binds = { id: resourceId };
    for (const [key, column] of Object.entries(UPDATABLE)) {
      if (patch[key] !== undefined) { sets.push(`${column} = :${key}`); binds[key] = patch[key]; }
    }
    if (patch.features !== undefined) {
      sets.push('features_json = :features');
      binds.features = patch.features ? JSON.stringify(patch.features) : null;
    }
    if (!sets.length) return 0;
    // Lock first so an update never interleaves with a booking being created.
    await conn.execute('SELECT resource_id FROM resources WHERE resource_id = :id FOR UPDATE WAIT 5', { id: resourceId });
    const res = await conn.execute(`UPDATE resources SET ${sets.join(', ')} WHERE resource_id = :id`, binds);
    return res.rowsAffected;
  });
}

export function listBlackouts(resourceId) {
  return withConnection(null, (conn) =>
    query(conn,
      `SELECT bo.blackout_id, bo.start_time, bo.end_time, bo.blackout_type, bo.reason, u.full_name AS created_by_name
         FROM resource_blackouts bo JOIN users u ON u.user_id = bo.created_by
        WHERE bo.resource_id = :id AND bo.end_time > SYSTIMESTAMP
        ORDER BY bo.start_time`, { id: resourceId }));
}

export function createBlackout(actorId, resourceId, { start, end, blackoutType, reason }) {
  return withTransaction(actorId, async (conn) => {
    // Serialise with booking creation on the same resource.
    const locked = await conn.execute(
      'SELECT resource_id FROM resources WHERE resource_id = :id FOR UPDATE WAIT 5', { id: resourceId });
    if (!locked.rows.length) return null;
    const conflicts = await query(conn,
      `SELECT COUNT(*) AS n FROM bookings
        WHERE resource_id = :id AND status IN ('PENDING','APPROVED')
          AND start_time < :e AND end_time > :s`,
      { id: resourceId, s: { ...TS, val: start }, e: { ...TS, val: end } });
    const res = await conn.execute(
      `INSERT INTO resource_blackouts (resource_id, start_time, end_time, blackout_type, reason, created_by)
       VALUES (:id, :s, :e, :type, :reason, :actor) RETURNING blackout_id INTO :bid`,
      {
        id: resourceId, s: { ...TS, val: start }, e: { ...TS, val: end }, type: blackoutType,
        reason, actor: actorId, bid: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );
    return { blackoutId: res.outBinds.bid[0], affectedBookings: conflicts[0].n };
  });
}

export function deleteBlackout(actorId, blackoutId) {
  return withTransaction(actorId, async (conn) => {
    const res = await conn.execute('DELETE FROM resource_blackouts WHERE blackout_id = :id', { id: blackoutId });
    return res.rowsAffected;
  });
}
