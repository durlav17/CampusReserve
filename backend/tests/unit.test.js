// Unit / HTTP-layer tests that need NO database: validation, authentication,
// authorisation, error mapping and the health endpoint.
// Run: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signToken } from '../src/middleware/auth.js';
import { fromOracleError, cleanOracleMessage } from '../src/utils/errors.js';
import * as S from '../src/validation/schemas.js';

const fakeUsers = {
  1: { userId: 1, fullName: 'Student One', roleCode: 'STUDENT', roleId: 1, canApprove: 'N', isActive: 'Y' },
  2: { userId: 2, fullName: 'Admin One', roleCode: 'ADMIN', roleId: 4, canApprove: 'Y', isActive: 'Y' },
};
const app = createApp({ loadUser: async (id) => fakeUsers[id] ?? null });
const tokenFor = (id) => signToken(fakeUsers[id]);

describe('Oracle error mapping', () => {
  test('application error -20005 becomes 409 BOOKING_CONFLICT with a clean message', () => {
    const err = { errorNum: 20005, message: 'ORA-20005: Time slot conflicts with booking #12.\nORA-06512: at "CAMPUS.SP_CREATE_BOOKING", line 120' };
    const h = fromOracleError(err);
    assert.equal(h.status, 409);
    assert.equal(h.code, 'BOOKING_CONFLICT');
    assert.equal(h.message, 'Time slot conflicts with booking #12.');
  });
  test('trigger overlap -20017 also maps to BOOKING_CONFLICT', () => {
    assert.equal(fromOracleError({ errorNum: 20017, message: 'ORA-20017: x' }).code, 'BOOKING_CONFLICT');
  });
  test('ORA-00001 maps to 409 and names the constraint only', () => {
    const h = fromOracleError({ errorNum: 1, message: 'ORA-00001: unique constraint (CAMPUS.UQ_USERS_EMAIL) violated' });
    assert.equal(h.status, 409);
    assert.deepEqual(h.details, { constraint: 'UQ_USERS_EMAIL' });
  });
  test('ORA-02291 (FK) maps to 400 INVALID_REFERENCE', () => {
    assert.equal(fromOracleError({ errorNum: 2291, message: 'ORA-02291: integrity constraint (CAMPUS.FK_X) violated' }).code, 'INVALID_REFERENCE');
  });
  test('unknown Oracle errors are not exposed', () => {
    assert.equal(fromOracleError({ errorNum: 600, message: 'ORA-00600: internal error' }), null);
    assert.equal(fromOracleError(new Error('plain')), null);
  });
  test('cleanOracleMessage strips prefix and stack', () => {
    assert.equal(cleanOracleMessage('ORA-20003: Lab is under maintenance.\nORA-06512: ...'), 'Lab is under maintenance.');
  });
});

describe('Validation schemas', () => {
  test('booking end must be after start', () => {
    const r = S.createBooking.safeParse({
      resourceId: 1, title: 'Demo', attendees: 5,
      start: '2026-11-20T12:00:00+05:30', end: '2026-11-20T11:00:00+05:30',
    });
    assert.equal(r.success, false);
  });
  test('valid booking converts ISO strings to Date objects', () => {
    const r = S.createBooking.safeParse({
      resourceId: '3', title: '  Lab session ', attendees: 10,
      start: '2026-11-20T10:00:00+05:30', end: '2026-11-20T12:00:00+05:30',
    });
    assert.equal(r.success, true);
    assert.ok(r.data.start instanceof Date);
    assert.equal(r.data.title, 'Lab session');
    assert.equal(r.data.resourceId, 3);
  });
  test('timestamps without an offset are rejected (no time-zone ambiguity)', () => {
    const r = S.availabilityQuery.safeParse({ start: '2026-11-20T10:00:00', end: '2026-11-20T11:00:00' });
    assert.equal(r.success, false);
  });
  test('weak passwords are rejected', () => {
    assert.equal(S.password.safeParse('password').success, false);
    assert.equal(S.password.safeParse('Campus2026').success, true);
  });
  test('admins cannot set MAINTENANCE status by hand', () => {
    assert.equal(S.updateResource.safeParse({ status: 'MAINTENANCE' }).success, false);
    assert.equal(S.updateResource.safeParse({ status: 'RETIRED' }).success, true);
  });
  test('rejection requires remarks', () => {
    assert.equal(S.rejection.safeParse({}).success, false);
  });
  test('analytics range defaults to the last 30 days', () => {
    const r = S.rangeQuery.parse({});
    assert.equal(Math.round((r.to - r.from) / 86400000), 30);
  });
});

describe('HTTP layer (no database)', () => {
  test('GET /api/health reports 503 degraded when the pool is not initialised', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 503);
    assert.equal(res.body.database, 'down');
  });
  test('unknown routes return 404 JSON', async () => {
    const res = await request(app).get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
  test('protected route without token -> 401', async () => {
    const res = await request(app).get('/api/bookings');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  });
  test('tampered token -> 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(1)}x`);
    assert.equal(res.status, 401);
  });
  test('valid token -> /api/auth/me returns the user', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(1)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role.code, 'STUDENT');
  });
  test('TC-12 student calling an admin endpoint -> 403 before any database work', async () => {
    const res = await request(app).post('/api/resources').set('Authorization', `Bearer ${tokenFor(1)}`)
      .send({ resourceCode: 'X-1', resourceName: 'X', categoryId: 1, managedByDept: 1, capacity: 1, opensAtHour: 8, closesAtHour: 9 });
    assert.equal(res.status, 403);
  });
  test('student cannot approve bookings -> 403', async () => {
    const res = await request(app).post('/api/bookings/5/approve').set('Authorization', `Bearer ${tokenFor(1)}`).send({});
    assert.equal(res.status, 403);
  });
  test('student cannot list all bookings -> 403', async () => {
    const res = await request(app).get('/api/bookings?scope=all').set('Authorization', `Bearer ${tokenFor(1)}`);
    assert.equal(res.status, 403);
  });
  test('invalid booking body -> 400 with field-level details', async () => {
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${tokenFor(1)}`)
      .send({ resourceId: 1, title: 'x', attendees: 0, start: 'tomorrow', end: 'later' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    assert.ok(fields.includes('body.attendees'));
    assert.ok(fields.includes('body.start'));
  });
  test('malformed JSON -> 400 INVALID_JSON', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });
  test('login validation runs before the database', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    assert.equal(res.status, 400);
  });
  test('security headers are set and x-powered-by is hidden', async () => {
    const res = await request(app).get('/');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.ok(res.headers['x-content-type-options']);
  });
});
