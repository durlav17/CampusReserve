// Maintenance, analytics, audit, notifications and user administration.
import { HttpError } from '../utils/errors.js';
import { STAFF_ROLES } from '../middleware/auth.js';
import * as maintenance from '../services/maintenanceService.js';
import * as analytics from '../services/analyticsService.js';
import * as activity from '../services/activityService.js';
import * as users from '../services/userService.js';
import { publicUser } from './authController.js';

// ---- maintenance ----------------------------------------------------------
export async function listMaintenance(req, res) {
  const q = { ...req.valid.query };
  // Students only see the tickets they reported.
  if (!STAFF_ROLES.includes(req.user.roleCode)) q.mine = true;
  res.json(await maintenance.listMaintenance(req.user, q));
}

export async function createMaintenance(req, res) {
  const requestId = await maintenance.submitMaintenance(req.user, req.valid.body);
  res.status(201).json({ requestId });
}

export async function updateMaintenance(req, res) {
  await maintenance.updateMaintenanceStatus(req.user, req.valid.params.id, req.valid.body);
  res.json({ ok: true });
}

export async function escalateMaintenance(req, res) {
  res.json({ escalated: await maintenance.escalateStale(req.user, req.valid.body.days) });
}

export async function assignees(req, res) {
  res.json({ items: await maintenance.listAssignees(req.user) });
}

// ---- analytics ------------------------------------------------------------
export async function analyticsSummary(req, res) {
  res.json({ summary: await analytics.summary(req.user.userId) });
}
export async function analyticsTrend(req, res) {
  res.json({ items: await analytics.trend(req.user.userId, req.valid.query.days) });
}
export async function analyticsTop(req, res) {
  const { from, to, limit } = req.valid.query;
  res.json({ items: await analytics.topResources(req.user.userId, from, to, limit) });
}
export async function analyticsDepartments(req, res) {
  const { from, to } = req.valid.query;
  res.json({ items: await analytics.departmentUsage(req.user.userId, from, to) });
}
export async function analyticsUtilisation(req, res) {
  const { from, to } = req.valid.query;
  res.json({ items: await analytics.utilisation(req.user.userId, from, to) });
}
export async function analyticsPeak(req, res) {
  const { from, to } = req.valid.query;
  res.json({ items: await analytics.peakHours(req.user.userId, from, to) });
}
export async function analyticsCategories(req, res) {
  const { from, to } = req.valid.query;
  res.json({ items: await analytics.categoryBreakdown(req.user.userId, from, to) });
}
export async function buildSnapshot(req, res) {
  const { from, to } = req.valid.query;
  res.status(201).json({ rows: await analytics.buildSnapshot(req.user.userId, from, to) });
}
export async function listSnapshots(req, res) {
  res.json({ items: await analytics.listSnapshots(req.user.userId) });
}

// ---- audit & notifications -------------------------------------------------
export async function listAudit(req, res) {
  res.json(await activity.listAudit(req.user.userId, req.valid.query));
}
export async function listNotifications(req, res) {
  res.json({ items: await activity.listNotifications(req.user.userId) });
}
export async function readNotification(req, res) {
  await activity.markRead(req.user.userId, req.valid.params.id);
  res.status(204).end();
}
export async function readAllNotifications(req, res) {
  await activity.markAllRead(req.user.userId);
  res.status(204).end();
}

// ---- user administration ----------------------------------------------------
export async function listUsers(req, res) {
  const result = await users.listUsers(req.user.userId, req.valid.query);
  res.json({ total: result.total, items: result.items.map((u) => ({ ...publicUser(u), isActive: u.isActive, bookingCount: u.bookingCount })) });
}

export async function updateUser(req, res) {
  const targetId = req.valid.params.id;
  if (targetId === req.user.userId) {
    throw new HttpError(400, 'SELF_UPDATE', 'Administrators cannot change their own role or status.');
  }
  const n = await users.adminUpdateUser(req.user.userId, targetId, req.valid.body);
  if (n === 0) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
  res.json({ ok: true });
}
