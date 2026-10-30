// Error types and the mapping from Oracle errors to HTTP responses.

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Application error codes raised by the PL/SQL layer (see 06_procedures.sql).
export const ORA_APP_ERRORS = {
  20001: { status: 400, code: 'INVALID_INTERVAL' },
  20002: { status: 404, code: 'RESOURCE_NOT_FOUND' },
  20003: { status: 409, code: 'RESOURCE_UNDER_MAINTENANCE' },
  20004: { status: 409, code: 'RESOURCE_RETIRED' },
  20005: { status: 409, code: 'BOOKING_CONFLICT' },
  20006: { status: 400, code: 'CAPACITY_EXCEEDED' },
  20007: { status: 409, code: 'BLACKOUT_PERIOD' },
  20008: { status: 400, code: 'OUTSIDE_OPERATING_HOURS' },
  20009: { status: 400, code: 'DURATION_EXCEEDED' },
  20010: { status: 404, code: 'BOOKING_NOT_FOUND' },
  20011: { status: 409, code: 'INVALID_STATUS_TRANSITION' },
  20012: { status: 403, code: 'FORBIDDEN' },
  20013: { status: 403, code: 'USER_INACTIVE' },
  20014: { status: 404, code: 'MAINTENANCE_NOT_FOUND' },
  20015: { status: 400, code: 'START_IN_PAST' },
  20016: { status: 400, code: 'INVALID_ARGUMENT' },
  20017: { status: 409, code: 'BOOKING_CONFLICT' },
  20018: { status: 409, code: 'RESOURCE_BUSY' },
  20019: { status: 400, code: 'INSUFFICIENT_NOTICE' },
};

// Standard Oracle errors that are caused by client input.
const ORA_STANDARD = {
  1: { status: 409, code: 'DUPLICATE', message: 'A record with the same unique value already exists.' },
  1400: { status: 400, code: 'MISSING_VALUE', message: 'A required value is missing.' },
  2290: { status: 400, code: 'CONSTRAINT_VIOLATION', message: 'A value violates a data rule.' },
  2291: { status: 400, code: 'INVALID_REFERENCE', message: 'A referenced record does not exist.' },
  2292: { status: 409, code: 'RECORD_IN_USE', message: 'The record is referenced by other data.' },
  12899: { status: 400, code: 'VALUE_TOO_LONG', message: 'A value is too long.' },
  30006: { status: 409, code: 'RESOURCE_BUSY', message: 'The record is locked by another user; please retry.' },
};

/** Removes the "ORA-2xxxx: " prefix and the PL/SQL stack lines that follow. */
export function cleanOracleMessage(message = '') {
  const first = String(message).split('\n')[0];
  return first.replace(/^ORA-\d{5}:\s*/, '').trim();
}

/**
 * Converts an error thrown by node-oracledb into an HttpError, or returns null
 * if it is not a recognised client-caused database error.
 */
export function fromOracleError(err) {
  const num = typeof err?.errorNum === 'number' ? err.errorNum : null;
  if (num === null) return null;
  const app = ORA_APP_ERRORS[num];
  if (app) return new HttpError(app.status, app.code, cleanOracleMessage(err.message));
  const std = ORA_STANDARD[num];
  if (std) {
    // Name the violated constraint (e.g. UQ_USERS_EMAIL) - useful, not sensitive.
    const constraint = /\(([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)\)/.exec(err.message || '');
    return new HttpError(std.status, std.code, std.message,
      constraint ? { constraint: constraint[2] } : undefined);
  }
  return null;
}
