import { withConnection, withTransaction, query, queryOne, oracledb } from '../config/db.js';

const USER_COLUMNS = `
  u.user_id, u.full_name, u.email, u.reg_no, u.phone, u.is_active, u.created_at, u.last_login_at,
  r.role_id, r.role_code, r.role_name, r.can_approve, r.can_administer,
  d.dept_id, d.dept_code, d.dept_name`;

const USER_FROM = `
  FROM users u
  JOIN roles r       ON r.role_id = u.role_id
  JOIN departments d ON d.dept_id = u.dept_id`;

export function findActiveUserById(userId) {
  return withConnection(userId, (conn) =>
    queryOne(conn, `SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.user_id = :id AND u.is_active = 'Y'`,
      { id: userId }));
}

/** Includes the password hash - only for the login flow. */
export function findForLogin(email) {
  return withConnection(null, (conn) =>
    queryOne(conn, `SELECT ${USER_COLUMNS}, u.password_hash ${USER_FROM} WHERE u.email = :email`,
      { email: email.toLowerCase() }));
}

export function recordLogin(userId) {
  return withTransaction(userId, (conn) =>
    conn.execute('UPDATE users SET last_login_at = SYSTIMESTAMP WHERE user_id = :id', { id: userId }));
}

export function createUser({ fullName, email, passwordHash, deptId, regNo, phone, roleId = 1 }) {
  return withTransaction(null, async (conn) => {
    const res = await conn.execute(
      `INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
       VALUES (:roleId, :deptId, :fullName, :email, :regNo, :phone, :hash)
       RETURNING user_id INTO :id`,
      {
        roleId, deptId, fullName, email, regNo: regNo || null, phone: phone || null, hash: passwordHash,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );
    return res.outBinds.id[0];
  });
}

export function updateProfile(userId, { fullName, phone }) {
  return withTransaction(userId, (conn) =>
    conn.execute(
      `UPDATE users SET full_name = NVL(:fullName, full_name), phone = :phone WHERE user_id = :id`,
      { fullName: fullName ?? null, phone: phone ?? null, id: userId },
    ));
}

export function getPasswordHash(userId) {
  return withConnection(userId, async (conn) => {
    const row = await queryOne(conn, 'SELECT password_hash FROM users WHERE user_id = :id', { id: userId });
    return row?.passwordHash ?? null;
  });
}

export function setPasswordHash(userId, hash) {
  return withTransaction(userId, (conn) =>
    conn.execute('UPDATE users SET password_hash = :hash WHERE user_id = :id', { hash, id: userId }));
}

export function listUsers(actorId, { q, role, deptId, limit, offset }) {
  return withConnection(actorId, async (conn) => {
    const where = ['1 = 1'];
    const binds = { limit, offset };
    if (q) {
      where.push(`(LOWER(u.full_name) LIKE :q OR u.email LIKE :q OR LOWER(u.reg_no) LIKE :q)`);
      binds.q = `%${q.toLowerCase()}%`;
    }
    if (role) { where.push('r.role_code = :role'); binds.role = role; }
    if (deptId) { where.push('u.dept_id = :deptId'); binds.deptId = deptId; }
    const rows = await query(conn,
      `SELECT ${USER_COLUMNS},
              (SELECT COUNT(*) FROM bookings b WHERE b.requested_by = u.user_id) AS booking_count,
              COUNT(*) OVER () AS total_count
       ${USER_FROM}
       WHERE ${where.join(' AND ')}
       ORDER BY r.role_id DESC, u.full_name
       OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, binds);
    return { total: rows[0]?.totalCount ?? 0, items: rows.map(({ totalCount, ...u }) => u) };
  });
}

export function adminUpdateUser(actorId, userId, { roleId, deptId, isActive }) {
  return withTransaction(actorId, async (conn) => {
    const res = await conn.execute(
      `UPDATE users
          SET role_id   = NVL(:roleId, role_id),
              dept_id   = NVL(:deptId, dept_id),
              is_active = NVL(:isActive, is_active)
        WHERE user_id = :id`,
      { roleId: roleId ?? null, deptId: deptId ?? null, isActive: isActive ?? null, id: userId },
    );
    return res.rowsAffected;
  });
}
