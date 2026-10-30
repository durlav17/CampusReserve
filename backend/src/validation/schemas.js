// Input schemas. Server-side validation is authoritative; the frontend repeats
// the friendlier checks only for user experience.
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const isoDateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const isoDate = z.iso.date();                               // YYYY-MM-DD
const trimmed = (min, max) => z.string().trim().min(min).max(max);
const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const idParam = z.object({ id });

export const password = z.string()
  .min(8, 'At least 8 characters')
  .max(72, 'At most 72 characters')                         // bcrypt limit
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');

export const register = z.object({
  fullName: trimmed(2, 120),
  email: z.email().max(160).transform((e) => e.toLowerCase()),
  password,
  deptId: id,
  regNo: optionalText(20),
  phone: z.string().trim().regex(/^[0-9+\- ]{7,16}$/, 'Invalid phone number').optional(),
});

export const login = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(72),
});

export const updateProfile = z.object({
  fullName: trimmed(2, 120).optional(),
  phone: z.string().trim().regex(/^[0-9+\- ]{7,16}$/, 'Invalid phone number').optional().or(z.literal('')),
});

export const changePassword = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: password,
});

export const resourceQuery = z.object({
  q: z.string().trim().max(60).optional(),
  categoryId: id.optional(),
  buildingId: id.optional(),
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'RETIRED']).optional(),
  minCapacity: z.coerce.number().int().min(0).max(5000).optional(),
});

export const scheduleQuery = z.object({ from: isoDateTime, to: isoDateTime })
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`', path: ['to'] })
  .refine((v) => v.to - v.from <= 62 * 86400000, { message: 'Window may not exceed 62 days', path: ['to'] });

export const slotsQuery = z.object({
  date: isoDate,
  slotMinutes: z.coerce.number().int().min(15).max(240).default(60),
});

export const availabilityQuery = z.object({ start: isoDateTime, end: isoDateTime });

const resourceBase = {
  resourceName: trimmed(2, 120),
  capacity: z.number().int().min(0).max(5000),
  opensAtHour: z.number().int().min(0).max(23),
  closesAtHour: z.number().int().min(1).max(24),
  description: z.string().trim().max(1000).optional(),
  buildingId: id.nullable().optional(),
  floorNo: z.number().int().min(0).max(50).nullable().optional(),
  roomNo: z.string().trim().max(20).nullable().optional(),
  features: z.record(z.string(), z.unknown()).nullable().optional(),
};

export const createResource = z.object({
  ...resourceBase,
  resourceCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, 'Use A-Z, 0-9 and dashes'),
  categoryId: id,
  managedByDept: id,
}).refine((r) => r.closesAtHour > r.opensAtHour, { message: 'Closing hour must be after opening hour', path: ['closesAtHour'] });

export const updateResource = z.object({
  ...Object.fromEntries(Object.entries(resourceBase).map(([k, v]) => [k, v.optional()])),
  // MAINTENANCE is driven by maintenance tickets, not set by hand.
  status: z.enum(['AVAILABLE', 'RETIRED']).optional(),
});

export const createBlackout = z.object({
  start: isoDateTime,
  end: isoDateTime,
  blackoutType: z.enum(['MAINTENANCE', 'HOLIDAY', 'EXAM', 'EVENT']),
  reason: trimmed(3, 400),
}).refine((b) => b.end > b.start, { message: 'End must be after start', path: ['end'] });

export const createBooking = z.object({
  resourceId: id,
  title: trimmed(3, 150),
  purpose: z.string().trim().max(1000).optional(),
  attendees: z.number().int().min(1).max(5000),
  start: isoDateTime,
  end: isoDateTime,
}).refine((b) => b.end > b.start, { message: 'End time must be later than start time', path: ['end'] });

export const bookingQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  resourceId: id.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const decision = z.object({ remarks: z.string().trim().max(500).optional() });
export const rejection = z.object({ remarks: trimmed(3, 500) });
export const cancellation = z.object({ reason: z.string().trim().max(400).optional() });

export const createMaintenance = z.object({
  resourceId: id,
  title: trimmed(3, 150),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  blocksBooking: z.boolean().default(false),
});

export const maintenanceStatus = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  assignedTo: id.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const maintenanceQuery = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  resourceId: id.optional(),
  mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Analytics date range: defaults to the last 30 days.
export const rangeQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(5),
  days: z.coerce.number().int().min(7).max(60).default(30),
}).transform((q) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const to = q.to ? new Date(`${q.to}T00:00:00`) : new Date(today.getTime() + 86400000);
  const from = q.from ? new Date(`${q.from}T00:00:00`) : new Date(to.getTime() - 30 * 86400000);
  return { ...q, from, to };
}).refine((q) => q.to > q.from, { message: '`to` must be after `from`', path: ['to'] });

export const auditQuery = z.object({
  table: z.enum(['BOOKINGS', 'MAINTENANCE_REQUESTS', 'RESOURCES']).optional(),
  recordId: id.optional(),
  action: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const userQuery = z.object({
  q: z.string().trim().max(60).optional(),
  role: z.enum(['STUDENT', 'FACULTY', 'COORDINATOR', 'ADMIN']).optional(),
  deptId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminUserUpdate = z.object({
  roleId: z.number().int().min(1).max(4).optional(),
  deptId: id.optional(),
  isActive: z.enum(['Y', 'N']).optional(),
});

export const escalation = z.object({ days: z.number().int().min(1).max(90).default(7) });
