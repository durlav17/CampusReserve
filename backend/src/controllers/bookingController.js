import { HttpError } from '../utils/errors.js';
import { APPROVER_ROLES } from '../middleware/auth.js';
import * as bookings from '../services/bookingService.js';

const isApprover = (user) => APPROVER_ROLES.includes(user.roleCode);

export async function create(req, res) {
  // Optional Idempotency-Key header: a retried POST returns the original booking.
  const key = req.get('idempotency-key');
  if (key && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
    throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-64 URL-safe characters.');
  }
  const result = await bookings.createBooking(req.user, req.valid.body, key);
  const booking = await bookings.getBooking(req.user, result.bookingId);
  res.status(result.duplicate ? 200 : 201).json({ booking, duplicate: result.duplicate });
}

export async function list(req, res) {
  const q = req.valid.query;
  if (q.scope === 'all' && !isApprover(req.user)) {
    throw new HttpError(403, 'FORBIDDEN', 'Only coordinators and administrators can list all bookings.');
  }
  res.json(await bookings.listBookings(req.user, q));
}

export async function get(req, res) {
  const booking = await bookings.getBooking(req.user, req.valid.params.id);
  // Report "not found" rather than "forbidden" so IDs cannot be probed.
  if (!booking || (booking.requesterId !== req.user.userId && !isApprover(req.user))) {
    throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  }
  res.json({ booking });
}

export async function approve(req, res) {
  await bookings.decideBooking(req.user, req.valid.params.id, 'APPROVED', req.valid.body.remarks);
  res.json({ booking: await bookings.getBooking(req.user, req.valid.params.id) });
}

export async function reject(req, res) {
  await bookings.decideBooking(req.user, req.valid.params.id, 'REJECTED', req.valid.body.remarks);
  res.json({ booking: await bookings.getBooking(req.user, req.valid.params.id) });
}

export async function cancel(req, res) {
  await bookings.cancelBooking(req.user, req.valid.params.id, req.valid.body.reason);
  res.json({ booking: await bookings.getBooking(req.user, req.valid.params.id) });
}

export async function pending(req, res) {
  res.json({ items: await bookings.pendingForApprover(req.user) });
}

export async function digest(req, res) {
  res.json({ pendingCount: await bookings.sendPendingDigest(req.user) });
}

export async function expire(req, res) {
  res.json({ expired: await bookings.expireStalePending(req.user) });
}
