import { HttpError, fromOracleError } from '../utils/errors.js';

export function notFound(req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

// Single place that turns any thrown error into a JSON response. Internal
// details (SQL text, stack traces, connection strings) never reach the client.
export function errorHandler(err, req, res, _next) {
  let httpErr = err instanceof HttpError ? err : fromOracleError(err);

  if (!httpErr && err?.type === 'entity.parse.failed') {
    httpErr = new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
  if (!httpErr && (err?.status === 503 || err?.code === 'NJS-500' || err?.code === 'NJS-503' || /^(ORA-125|ORA-01017|ORA-28000|ORA-28001|NJS-040|NJS-5)/.test(err?.message || ''))) {
    httpErr = new HttpError(503, 'DATABASE_UNAVAILABLE', 'The database is temporarily unavailable.');
  }
  if (!httpErr) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    httpErr = new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }

  res.status(httpErr.status).json({
    error: { code: httpErr.code, message: httpErr.message, details: httpErr.details },
  });
}
