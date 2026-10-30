// Authentication (JWT bearer tokens) and role-based authorisation.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../utils/errors.js';
import { findActiveUserById } from '../services/userService.js';

export const ROLES = Object.freeze({
  STUDENT: 'STUDENT',
  FACULTY: 'FACULTY',
  COORDINATOR: 'COORDINATOR',
  ADMIN: 'ADMIN',
});
export const APPROVER_ROLES = [ROLES.COORDINATOR, ROLES.ADMIN];
export const STAFF_ROLES = [ROLES.FACULTY, ROLES.COORDINATOR, ROLES.ADMIN];

export function signToken(user) {
  return jwt.sign({ sub: String(user.userId), role: user.roleCode }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Verifies the bearer token, then reloads the user so that deactivation or a
 * role change takes effect immediately rather than when the token expires.
 * `loadUser` is injectable for tests.
 */
export function requireAuth({ loadUser = findActiveUserById } = {}) {
  return async (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.'));
    }
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return next(new HttpError(401, 'INVALID_TOKEN', 'Your session has expired. Please sign in again.'));
    }
    try {
      const user = await loadUser(Number(payload.sub));
      if (!user) return next(new HttpError(401, 'INVALID_TOKEN', 'Account not found or disabled.'));
      req.user = user;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Allows the request only if req.user.roleCode is one of `roles`. */
export function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.'));
    if (!allowed.includes(req.user.roleCode)) {
      return next(new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    }
    return next();
  };
}
