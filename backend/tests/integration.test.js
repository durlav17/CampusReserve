// End-to-end API tests against a REAL Oracle schema (seeded with 03_seed_data.sql).
// Skipped unless RUN_DB_TESTS=1, because they need a database.
//   RUN_DB_TESTS=1 DB_PASSWORD=... DB_CONNECT_STRING=localhost:1521/FREEPDB1 npm test
// Bookings are created 40+ days ahead and cancelled at the end; test users
// created by TC-01 remain (they use unique it-<timestamp> e-mail addresses).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const RUN = process.env.RUN_DB_TESTS === '1';
const PASSWORD = 'Campus@2026';

describe('API integration (Oracle)', { skip: !RUN && 'set RUN_DB_TESTS=1 to run against Oracle' }, () => {
  let app; let db;
  const tokens = {};
  const created = [];
  const stamp = Date.now();

  // A future day that is not a Sunday and lies beyond the seeded data.
  const day = new Date();
  day.setDate(day.getDate() + 40 + (stamp % 5));
  if (day.getDay() === 0) day.setDate(day.getDate() + 1);
  const at = (h, m = 0) => {
    const d = new Date(day); d.setHours(h, m, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}:00+05:30`;
  };
  const auth = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

  before(async () => {
    db = await import('../src/config/db.js');
    await db.initPool();
    app = (await import('../src/app.js')).createApp();
    for (const [who, email] of Object.entries({
      student: 'rohan.g@campusreserve.example',
      student2: 'sneha.k@campusreserve.example',
      coord: 'coord.scope@campusreserve.example',
      admin: 'admin@campusreserve.example',
      faculty: 'kiran.menon@campusreserve.example',
    })) {
      const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
      assert.equal(res.status, 200, `login ${email}`);
      tokens[who] = res.body.token;
    }
  });

  after(async () => {
    for (const id of created) {
      await request(app).post(`/api/bookings/${id}/cancel`).set(auth('admin')).send({ reason: 'integration test cleanup' });
    }
    await db.closePool();
  });

  const resourceId = async (code) => {
    const res = await request(app).get(`/api/resources?q=${code}`).set(auth('student'));
    return res.body.items.find((r) => r.resourceCode === code).resourceId;
  };

  test('TC-01 registration creates a STUDENT and returns a token', async () => {
    const deps = await request(app).get('/api/departments');
    const res = await request(app).post('/api/auth/register').send({
      fullName: 'Integration Tester', email: `it-${stamp}@campusreserve.example`,
      password: 'Testing123', deptId: deps.body.items[0].deptId,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role.code, 'STUDENT');
    assert.ok(res.body.token);
  });

  test('TC-01b duplicate e-mail -> 409', async () => {
    const deps = await request(app).get('/api/departments');
    const res = await request(app).post('/api/auth/register').send({
      fullName: 'Dup', email: `IT-${stamp}@campusreserve.example`, password: 'Testing123', deptId: deps.body.items[0].deptId,
    });
    assert.equal(res.status, 409);
  });

  test('TC-02 login succeeds (covered in before) and /auth/me works', async () => {
    const res = await request(app).get('/api/auth/me').set(auth('student'));
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'rohan.g@campusreserve.example');
  });

  test('TC-03 invalid login -> 401 with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'rohan.g@campusreserve.example', password: 'wrong-password1' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('TC-05/06 booking then overlapping booking -> 201 then 409', async () => {
    const lab = await resourceId('SJT-LAB-516');
    const ok = await request(app).post('/api/bookings').set(auth('student'))
      .send({ resourceId: lab, title: 'Integration booking', attendees: 10, start: at(10), end: at(12) });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.booking.status, 'PENDING');
    created.push(ok.body.booking.bookingId);

    const clash = await request(app).post('/api/bookings').set(auth('student2'))
      .send({ resourceId: lab, title: 'Clash', attendees: 5, start: at(11), end: at(13) });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'BOOKING_CONFLICT');
  });

  test('TC-07 ten simultaneous requests for one slot -> exactly one succeeds', async () => {
    const room = await resourceId('SJT-CR-305');
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      request(app).post('/api/bookings').set(auth(i % 2 ? 'student' : 'student2'))
        .send({ resourceId: room, title: `Race ${i}`, attendees: 5, start: at(14), end: at(15) })));
    const statuses = attempts.map((r) => r.status);
    const wins = attempts.filter((r) => r.status === 201);
    wins.forEach((w) => created.push(w.body.booking.bookingId));
    assert.equal(wins.length, 1, `statuses: ${statuses.join(',')}`);
    assert.ok(attempts.filter((r) => r.status === 409).length === 9);
  });

  test('TC-08 coordinator approves; TC-09 coordinator rejects', async () => {
    const lab = await resourceId('SJT-LAB-516');
    const a = await request(app).post('/api/bookings').set(auth('student'))
      .send({ resourceId: lab, title: 'To approve', attendees: 5, start: at(14), end: at(16) });
    const b = await request(app).post('/api/bookings').set(auth('student2'))
      .send({ resourceId: lab, title: 'To reject', attendees: 5, start: at(16), end: at(18) });
    created.push(a.body.booking.bookingId, b.body.booking.bookingId);
    const ap = await request(app).post(`/api/bookings/${a.body.booking.bookingId}/approve`).set(auth('coord')).send({});
    assert.equal(ap.status, 200);
    assert.equal(ap.body.booking.status, 'APPROVED');
    const rj = await request(app).post(`/api/bookings/${b.body.booking.bookingId}/reject`).set(auth('coord')).send({ remarks: 'Clashes with lab exam' });
    assert.equal(rj.status, 200);
    assert.equal(rj.body.booking.status, 'REJECTED');
  });

  test('TC-10 cancellation frees the slot', async () => {
    const room = await resourceId('SJT-CR-302');
    const b = await request(app).post('/api/bookings').set(auth('student'))
      .send({ resourceId: room, title: 'Cancel me', attendees: 5, start: at(9), end: at(10) });
    assert.equal(b.status, 201);
    const c = await request(app).post(`/api/bookings/${b.body.booking.bookingId}/cancel`).set(auth('student')).send({ reason: 'test' });
    assert.equal(c.body.booking.status, 'CANCELLED');
    const v = await request(app).get(`/api/resources/${room}/availability`).query({ start: at(9), end: at(10) }).set(auth('student'));
    assert.equal(v.body.verdict, 'AVAILABLE');
  });

  test('TC-11 booking a resource under maintenance -> 409', async () => {
    const closed = await resourceId('SMV-LAB-220');
    const res = await request(app).post('/api/bookings').set(auth('faculty'))
      .send({ resourceId: closed, title: 'Nope', attendees: 5, start: at(10), end: at(11) });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'RESOURCE_UNDER_MAINTENANCE');
  });

  test('TC-12 student calling admin user list -> 403', async () => {
    const res = await request(app).get('/api/users').set(auth('student'));
    assert.equal(res.status, 403);
  });

  test('TC-15 audit history is returned with booking details', async () => {
    const res = await request(app).get(`/api/bookings/${created[0]}`).set(auth('student'));
    assert.equal(res.status, 200);
    assert.ok(res.body.booking.history.length >= 1);
  });

  // UID is reserved in Oracle SQL: a :uid bind in these queries fails with ORA-01745.
  test('a user can list their own bookings, tickets and notifications', async () => {
    for (const path of ['/api/bookings', '/api/maintenance', '/api/notifications']) {
      const res = await request(app).get(path).set(auth('student'));
      assert.equal(res.status, 200, path);
      assert.ok(Array.isArray(res.body.items), path);
    }
  });

  test('TC-16 analytics endpoints answer from the database', async () => {
    const s = await request(app).get('/api/analytics/summary').set(auth('admin'));
    assert.equal(s.status, 200);
    assert.ok(Number.isFinite(s.body.summary.totalResources));
    const u = await request(app).get('/api/analytics/utilisation').set(auth('admin'));
    assert.ok(u.body.items.length > 0);
  });
});
