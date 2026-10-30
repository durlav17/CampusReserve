import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole, ROLES, APPROVER_ROLES, STAFF_ROLES } from '../middleware/auth.js';
import * as S from '../validation/schemas.js';
import * as auth from '../controllers/authController.js';
import * as resources from '../controllers/resourceController.js';
import * as bookings from '../controllers/bookingController.js';
import * as misc from '../controllers/miscController.js';
import { isPoolReady, withConnection } from '../config/db.js';

const ADMIN = [ROLES.ADMIN];
const params = { params: S.idParam };

export function buildRouter({ loadUser } = {}) {
  const r = Router();
  const authed = requireAuth(loadUser ? { loadUser } : undefined);

  // Brute-force protection for credential endpoints.
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } },
  });

  // ---- health -------------------------------------------------------------
  r.get('/health', async (_req, res) => {
    const body = { status: 'ok', service: 'campusreserve-api', time: new Date().toISOString(), database: 'down' };
    if (isPoolReady()) {
      try {
        await withConnection(null, (c) => c.execute('SELECT 1 FROM dual'));
        body.database = 'up';
      } catch { /* reported as down */ }
    }
    res.status(body.database === 'up' ? 200 : 503).json({ ...body, status: body.database === 'up' ? 'ok' : 'degraded' });
  });

  // ---- auth & profile -------------------------------------------------------
  r.post('/auth/register', credentialLimiter, validate({ body: S.register }), auth.register);
  r.post('/auth/login', credentialLimiter, validate({ body: S.login }), auth.login);
  r.get('/auth/me', authed, auth.me);
  r.patch('/auth/me', authed, validate({ body: S.updateProfile }), auth.updateMe);
  r.post('/auth/change-password', authed, credentialLimiter, validate({ body: S.changePassword }), auth.changePassword);

  // ---- reference data (departments are public: needed by the sign-up form) -
  r.get('/departments', resources.departments);
  r.get('/buildings', authed, resources.buildings);
  r.get('/categories', authed, resources.categories);
  r.get('/roles', authed, requireRole(ADMIN), resources.roles);

  // ---- resources ------------------------------------------------------------
  r.get('/resources', authed, validate({ query: S.resourceQuery }), resources.list);
  r.post('/resources', authed, requireRole(ADMIN), validate({ body: S.createResource }), resources.create);
  r.get('/resources/:id', authed, validate(params), resources.get);
  r.patch('/resources/:id', authed, requireRole(ADMIN), validate({ ...params, body: S.updateResource }), resources.update);
  r.get('/resources/:id/schedule', authed, validate({ ...params, query: S.scheduleQuery }), resources.schedule);
  r.get('/resources/:id/slots', authed, validate({ ...params, query: S.slotsQuery }), resources.slots);
  r.get('/resources/:id/availability', authed, validate({ ...params, query: S.availabilityQuery }), resources.availability);
  r.get('/resources/:id/blackouts', authed, validate(params), resources.blackouts);
  r.post('/resources/:id/blackouts', authed, requireRole(APPROVER_ROLES),
    validate({ ...params, body: S.createBlackout }), resources.createBlackout);
  r.delete('/blackouts/:id', authed, requireRole(APPROVER_ROLES), validate(params), resources.deleteBlackout);

  // ---- bookings -------------------------------------------------------------
  r.get('/bookings', authed, validate({ query: S.bookingQuery }), bookings.list);
  r.post('/bookings', authed, validate({ body: S.createBooking }), bookings.create);
  r.get('/bookings/:id', authed, validate(params), bookings.get);
  r.post('/bookings/:id/approve', authed, requireRole(APPROVER_ROLES), validate({ ...params, body: S.decision }), bookings.approve);
  r.post('/bookings/:id/reject', authed, requireRole(APPROVER_ROLES), validate({ ...params, body: S.rejection }), bookings.reject);
  r.post('/bookings/:id/cancel', authed, validate({ ...params, body: S.cancellation }), bookings.cancel);
  r.get('/approvals/pending', authed, requireRole(APPROVER_ROLES), bookings.pending);
  r.post('/approvals/digest', authed, requireRole(APPROVER_ROLES), bookings.digest);
  r.post('/jobs/expire-pending', authed, requireRole(ADMIN), bookings.expire);

  // ---- maintenance ----------------------------------------------------------
  r.get('/maintenance', authed, validate({ query: S.maintenanceQuery }), misc.listMaintenance);
  r.post('/maintenance', authed, validate({ body: S.createMaintenance }), misc.createMaintenance);
  r.patch('/maintenance/:id/status', authed, requireRole(APPROVER_ROLES),
    validate({ ...params, body: S.maintenanceStatus }), misc.updateMaintenance);
  r.get('/maintenance/assignees', authed, requireRole(STAFF_ROLES), misc.assignees);
  r.post('/jobs/escalate-maintenance', authed, requireRole(ADMIN), validate({ body: S.escalation }), misc.escalateMaintenance);

  // ---- analytics (staff only) ------------------------------------------------
  const analyticsGuard = [authed, requireRole(STAFF_ROLES)];
  r.get('/analytics/summary', authed, misc.analyticsSummary);   // every role sees the KPI tiles
  r.get('/analytics/trend', ...analyticsGuard, validate({ query: S.rangeQuery }), misc.analyticsTrend);
  r.get('/analytics/top-resources', ...analyticsGuard, validate({ query: S.rangeQuery }), misc.analyticsTop);
  r.get('/analytics/departments', ...analyticsGuard, validate({ query: S.rangeQuery }), misc.analyticsDepartments);
  r.get('/analytics/utilisation', ...analyticsGuard, validate({ query: S.rangeQuery }), misc.analyticsUtilisation);
  r.get('/analytics/peak-hours', ...analyticsGuard, validate({ query: S.rangeQuery }), misc.analyticsPeak);
  r.get('/analytics/categories', ...analyticsGuard, validate({ query: S.rangeQuery }), misc.analyticsCategories);
  r.get('/analytics/snapshots', ...analyticsGuard, misc.listSnapshots);
  r.post('/analytics/snapshots', authed, requireRole(ADMIN), validate({ query: S.rangeQuery }), misc.buildSnapshot);

  // ---- audit, notifications, users -------------------------------------------
  r.get('/audit', authed, requireRole(APPROVER_ROLES), validate({ query: S.auditQuery }), misc.listAudit);
  r.get('/notifications', authed, misc.listNotifications);
  r.post('/notifications/read-all', authed, misc.readAllNotifications);
  r.post('/notifications/:id/read', authed, validate(params), misc.readNotification);
  r.get('/users', authed, requireRole(ADMIN), validate({ query: S.userQuery }), misc.listUsers);
  r.patch('/users/:id', authed, requireRole(ADMIN), validate({ ...params, body: S.adminUserUpdate }), misc.updateUser);

  return r;
}
