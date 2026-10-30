# REST API Reference

Base URL: `http://localhost:4000/api` locally, `https://<your-render-service>.onrender.com/api` in production.
All bodies are JSON. Timestamps must be ISO-8601 **with an offset** (e.g. `2026-11-20T10:00:00+05:30`); responses return UTC ISO strings.

## Conventions

**Authentication.** `POST /auth/login` or `/auth/register` returns `{ token, user }`. Send `Authorization: Bearer <token>` on every other call. Tokens are HS256 JWTs valid for `JWT_EXPIRES_IN` (default 8 h). The user is reloaded on every request, so deactivation and role changes apply immediately.

**Roles.** `S` student, `F` faculty, `C` coordinator, `A` admin. "Any" means any signed-in user.

**Errors.** Every error has the same shape:

```json
{ "error": { "code": "BOOKING_CONFLICT", "message": "Time slot conflicts with booking #412.", "details": null } }
```

| HTTP | Typical `code` values |
|---|---|
| 400 | `VALIDATION_ERROR` (with `details: [{field, message}]`), `INVALID_JSON`, `INVALID_INTERVAL`, `CAPACITY_EXCEEDED`, `OUTSIDE_OPERATING_HOURS`, `DURATION_EXCEEDED`, `START_IN_PAST`, `INSUFFICIENT_NOTICE`, `INVALID_REFERENCE`, `CONSTRAINT_VIOLATION` |
| 401 | `UNAUTHENTICATED`, `INVALID_TOKEN`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `USER_INACTIVE` |
| 404 | `NOT_FOUND`, `RESOURCE_NOT_FOUND`, `BOOKING_NOT_FOUND`, `MAINTENANCE_NOT_FOUND` |
| 409 | `BOOKING_CONFLICT`, `RESOURCE_UNDER_MAINTENANCE`, `RESOURCE_RETIRED`, `BLACKOUT_PERIOD`, `INVALID_STATUS_TRANSITION`, `RESOURCE_BUSY`, `DUPLICATE` |
| 429 | `RATE_LIMITED` (300 requests/min per IP; 20 credential attempts per 15 min) |
| 503 | `DATABASE_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` (details are logged on the server, never returned) |

Oracle application errors `ORA-20001…ORA-20019` raised by PL/SQL are translated in `backend/src/utils/errors.js`.

**Security.** Every SQL statement uses bind variables; dynamic `WHERE` fragments are built only from constant strings. Passwords are bcrypt-hashed (cost 10). `helmet` sets security headers; CORS allows only `CORS_ORIGINS`.

## Health

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | `200 {status:"ok", database:"up"}` or `503 {status:"degraded", database:"down"}` |

## Authentication and profile

| Method | URL | Auth | Body / query | Result |
|---|---|---|---|---|
| POST | `/auth/register` | none | `{fullName, email, password, deptId, regNo?, phone?}` | `201 {token, user}`; role is always STUDENT |
| POST | `/auth/login` | none | `{email, password}` | `200 {token, user}`; 401 on bad credentials |
| GET | `/auth/me` | Any | — | `{user}` |
| PATCH | `/auth/me` | Any | `{fullName?, phone?}` | `{user}` |
| POST | `/auth/change-password` | Any | `{currentPassword, newPassword}` | 204 |

Example:

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "rohan.g@campusreserve.example", "password": "Campus@2026" }
```
```json
{ "token": "eyJhbGciOi...", "user": { "userId": 7, "fullName": "Rohan Gupta", "role": { "code": "STUDENT" },
  "department": { "code": "SCOPE" }, "canApprove": false } }
```

## Reference data

| Method | URL | Auth | Result |
|---|---|---|---|
| GET | `/departments` | none (needed by sign-up) | departments with user/resource counts |
| GET | `/buildings` | Any | buildings with resource counts |
| GET | `/categories` | Any | categories with booking policy |
| GET | `/roles` | A | roles |

## Resources

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/resources?q=&categoryId=&buildingId=&status=&minCapacity=` | Any | search `V_RESOURCE_CATALOG` |
| GET | `/resources/:id` | Any | detail + 30-day utilisation (`FN_RESOURCE_UTILISATION`), upcoming bookings, open tickets |
| GET | `/resources/:id/schedule?from=&to=` | Any | bookings + blackouts (`PKG_CAMPUS_RESERVATIONS.RESOURCE_SCHEDULE`, max 62 days) |
| GET | `/resources/:id/slots?date=YYYY-MM-DD&slotMinutes=60` | Any | slot states from pipelined `DAY_SLOTS` |
| GET | `/resources/:id/availability?start=&end=` | Any | `{verdict, available}` from `FN_RESOURCE_AVAILABILITY` (advisory) |
| POST | `/resources` | A | create; body `{resourceCode, resourceName, categoryId, managedByDept, capacity, opensAtHour, closesAtHour, buildingId?, floorNo?, roomNo?, description?, features?}` |
| PATCH | `/resources/:id` | A | partial update; `status` may be `AVAILABLE` or `RETIRED` (MAINTENANCE is driven by tickets) |
| GET | `/resources/:id/blackouts` | Any | future blackouts |
| POST | `/resources/:id/blackouts` | C, A | `{start, end, blackoutType, reason}` → `{blackoutId, affectedBookings}` |
| DELETE | `/blackouts/:id` | C, A | 204 |

## Bookings

| Method | URL | Auth | Purpose |
|---|---|---|---|
| POST | `/bookings` | Any | create via `SP_CREATE_BOOKING`. Optional header `Idempotency-Key` (8–64 URL-safe chars): a retry returns the original booking with `200 {duplicate:true}` |
| GET | `/bookings?scope=mine\|all&status=&resourceId=&from=&to=&limit=&offset=` | Any (`all` = C, A) | paged list `{total, items}` |
| GET | `/bookings/:id` | owner or C, A | detail + audit history |
| POST | `/bookings/:id/approve` | C, A | `{remarks?}` → `SP_DECIDE_BOOKING` |
| POST | `/bookings/:id/reject` | C, A | `{remarks}` (required) |
| POST | `/bookings/:id/cancel` | owner or C, A | `{reason?}` → `SP_CANCEL_BOOKING` |
| GET | `/approvals/pending` | C, A | queue the caller may decide (`PENDING_FOR_APPROVER`) |
| POST | `/approvals/digest` | C, A | explicit-cursor digest → `{pendingCount}` |
| POST | `/jobs/expire-pending` | A | auto-reject PENDING requests whose start passed → `{expired}` |

Create example:

```http
POST /api/bookings
Authorization: Bearer <token>
Idempotency-Key: 9f1c2a7be04d4c11
Content-Type: application/json

{ "resourceId": 1, "title": "DBMS project review", "attendees": 12,
  "start": "2026-11-20T10:00:00+05:30", "end": "2026-11-20T12:00:00+05:30" }
```
```json
201 { "booking": { "bookingId": 412, "status": "PENDING", "durationHours": 2, "resourceCode": "SJT-LAB-516", "history": [ ... ] },
      "duplicate": false }
```
Conflict:
```json
409 { "error": { "code": "BOOKING_CONFLICT", "message": "Time slot conflicts with booking #412." } }
```

## Maintenance

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/maintenance?status=&priority=&resourceId=&mine=&limit=&offset=` | Any (students see only their own) | `V_MAINTENANCE_DASHBOARD` |
| POST | `/maintenance` | Any (`blocksBooking:true` = F, C, A) | `{resourceId, title, description?, priority, blocksBooking}` → `SP_SUBMIT_MAINTENANCE` |
| PATCH | `/maintenance/:id/status` | C, A | `{status, assignedTo?, notes?}` → `SP_UPDATE_MAINTENANCE_STATUS` |
| GET | `/maintenance/assignees` | F, C, A | possible assignees |
| POST | `/jobs/escalate-maintenance` | A | `{days}` → cursor FOR loop escalation → `{escalated}` |

## Analytics (all values computed in Oracle)

`from` / `to` are `YYYY-MM-DD` (default: the last 30 days).

| Method | URL | Auth | Source |
|---|---|---|---|
| GET | `/analytics/summary` | Any | `PKG_RESOURCE_ANALYTICS.DASHBOARD_SUMMARY` |
| GET | `/analytics/trend?days=` | F, C, A | `BOOKING_TREND` |
| GET | `/analytics/top-resources?from=&to=&limit=` | F, C, A | `TOP_RESOURCES` |
| GET | `/analytics/departments?from=&to=` | F, C, A | `DEPARTMENT_USAGE` |
| GET | `/analytics/utilisation?from=&to=` | F, C, A | `RESOURCE_UTILISATION` |
| GET | `/analytics/peak-hours?from=&to=` | F, C, A | `PEAK_HOURS` |
| GET | `/analytics/categories?from=&to=` | F, C, A | aggregate SQL |
| GET | `/analytics/snapshots` | F, C, A | stored snapshots |
| POST | `/analytics/snapshots?from=&to=` | A | `BUILD_UTILISATION_SNAPSHOT` → `{rows}` |

## Audit, notifications, users

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/audit?table=&recordId=&action=&limit=&offset=` | C, A | trigger-written audit log |
| GET | `/notifications` | Any | latest 50 |
| POST | `/notifications/:id/read` | Any | 204 |
| POST | `/notifications/read-all` | Any | 204 |
| GET | `/users?q=&role=&deptId=&limit=&offset=` | A | user list |
| PATCH | `/users/:id` | A | `{roleId?, deptId?, isActive?}`; admins cannot change themselves |
