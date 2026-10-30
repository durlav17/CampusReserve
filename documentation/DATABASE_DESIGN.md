# Database Design

Target: Oracle Database 19c or later (tested syntax choices avoid 23ai-only features such as SQL `BOOLEAN` and `DROP ... IF EXISTS`). Diagrams: `documentation/diagrams/*.mmd`, rendered PNGs in `report/figures/`.

## 1. Entities and their purpose

| Table | Purpose | Key attributes |
|---|---|---|
| `ROLES` | Authorisation level; flags decide who may approve / administer | `role_id` PK, `role_code` UK |
| `DEPARTMENTS` | Schools and offices that own resources and users | `dept_id` PK, `dept_code` UK, `dept_name` UK |
| `USERS` | Everyone who can sign in | `user_id` PK, `email` UK, `reg_no` UK, FKs to role and department |
| `BUILDINGS` | Physical buildings | `building_id` PK, `building_code` UK |
| `RESOURCE_CATEGORIES` | Booking policy shared by a class of resources | `requires_approval`, `max_booking_hours`, `min_notice_hours` |
| `RESOURCES` | Anything bookable | `resource_code` UK, `status`, `capacity`, operating hours, `features_json` |
| `BOOKINGS` | One reservation of one resource for one half-open interval `[start, end)` | `status`, `request_key` UK (idempotency) |
| `BOOKING_APPROVALS` | The single human (or automatic) decision on a booking | `booking_id` UK + FK |
| `MAINTENANCE_REQUESTS` | Fault tickets; `blocks_booking='Y'` takes a resource out of service | `priority`, `status` |
| `RESOURCE_BLACKOUTS` | Scheduled unavailability (exams, holidays, servicing) | interval, `blackout_type` |
| `AUDIT_LOGS` | Append-only history written only by triggers | `(table_name, record_id)` |
| `NOTIFICATIONS` | In-app messages | `user_id` FK, `is_read` |
| `UTILISATION_SNAPSHOTS` | Periodic analytics output of a cursor procedure | UK `(resource_id, period_start, period_end)` |

## 2. Relationships and cardinalities

- ROLE 1 — N USER; DEPARTMENT 1 — N USER; DEPARTMENT 1 — N RESOURCE (manager).
- BUILDING 0..1 — N RESOURCE (portable equipment has no building, so `building_id` is nullable).
- CATEGORY 1 — N RESOURCE.
- RESOURCE 1 — N BOOKING; USER 1 — N BOOKING (requester).
- BOOKING 1 — 0..1 BOOKING_APPROVAL (enforced by `UQ_APPROVALS_BOOKING`); USER 1 — N BOOKING_APPROVAL (approver).
- RESOURCE 1 — N MAINTENANCE_REQUEST; USER 1 — N (reporter) and 0..1 — N (assignee).
- RESOURCE 1 — N BLACKOUT; MAINTENANCE_REQUEST 0..1 — N BLACKOUT.
- USER 1 — N NOTIFICATION; BOOKING 0..1 — N NOTIFICATION.
- AUDIT_LOGS deliberately has **no foreign key**: audit rows must outlive the rows they describe and must never block a delete.

## 3. Constraint inventory

| Kind | Examples |
|---|---|
| PRIMARY KEY | 13, one per table (identity columns, except fixed `ROLES.role_id`) |
| FOREIGN KEY | 18, all named `fk_*`; `ON DELETE CASCADE` only for dependent data (approvals, notifications, snapshots); `ON DELETE SET NULL` for optional links |
| UNIQUE | `uq_users_email`, `uq_users_reg_no`, `uq_resources_code`, `uq_bookings_request_key`, `uq_approvals_booking`, `uq_snap_resource_period`, codes and names of reference tables |
| CHECK | `ck_bookings_interval (end_time > start_time)`, status domains, `ck_bookings_cancel` (cancelled ⇔ `cancelled_at` set), `ck_maint_resolved` (resolved/closed ⇔ `resolved_at` set), operating hours, capacity ≥ 0, e-mail format (`REGEXP_LIKE`), `features_json IS JSON` |
| NOT NULL / DEFAULT | every mandatory column; defaults for statuses, flags and timestamps |

Rules that need other rows (overlap, maintenance, approval rights) cannot be CHECK constraints in Oracle; they are enforced by procedures and triggers (§5).

## 4. Normalisation

### 4.1 Starting point (UNF)

A paper/spreadsheet booking register typically looks like:

`BOOKING_SHEET(booking_no, requester_name, requester_email, requester_dept, dept_office, resource_code, resource_name, building_code, building_name, category, requires_approval, max_hours, { date, start, end }, approver_email, approver_name, decision, remarks)`

The braces mark a **repeating group**: one request can list several dates.

### 4.2 First normal form

Remove the repeating group: one row per booked interval, every value atomic. Each interval becomes its own booking.

`BOOKING_1NF(booking_id, start_time, end_time, requester_email, requester_name, requester_dept, dept_name, resource_code, resource_name, building_code, building_name, category, requires_approval, max_hours, approver_email, approver_name, decision, remarks)` — key `booking_id`.

### 4.3 Functional dependencies identified

```
booking_id        -> start_time, end_time, requester_email, resource_code, status
requester_email   -> requester_name, requester_dept, role
requester_dept    -> dept_name
role              -> can_approve, can_administer
resource_code     -> resource_name, building_code, category, capacity, opens_at, closes_at, managed_by_dept
building_code     -> building_name, campus_zone
category          -> requires_approval, max_hours, min_notice_hours
booking_id        -> approver_email, decision, remarks, decided_at   (at most one decision)
approver_email    -> approver_name
```

### 4.4 Second normal form

With a single-attribute key (`booking_id`) there can be no partial dependency, so `BOOKING_1NF` is formally in 2NF. If the natural key `(resource_code, start_time)` had been used instead, `resource_name`, `building_code` and `category` would depend on only part of it (`resource_code`) — a partial dependency. Either way the design separates the entity data:

- `BOOKINGS(booking_id, resource_code, requester_email, start_time, end_time, status, ...)`
- `USERS(email, full_name, dept, role)`
- `RESOURCES(resource_code, resource_name, building_code, category, capacity, ...)`
- `APPROVALS(booking_id, approver_email, decision, remarks)`

### 4.5 Third normal form

Remove **transitive** dependencies (non-key → non-key):

| Transitive dependency | Decomposed into |
|---|---|
| `resource_code → category → requires_approval, max_hours` | `RESOURCE_CATEGORIES` |
| `resource_code → building_code → building_name` | `BUILDINGS` |
| `email → dept_code → dept_name` | `DEPARTMENTS` |
| `email → role → can_approve` | `ROLES` |

Surrogate keys (`*_id`) replace the natural codes as foreign keys; the codes stay as `UNIQUE` candidate keys.

### 4.6 BCNF check

A relation is in BCNF when every determinant is a candidate key. In the final schema:

- `USERS`: determinants `user_id`, `email`, `reg_no` — all candidate keys (`reg_no` is unique when present).
- `RESOURCES`: `resource_id`, `resource_code` — both candidate keys.
- `BOOKINGS`: `booking_id`, `request_key` (unique when present). The pair `(resource_id, start_time)` is *not* declared unique because cancelled and rejected bookings may legitimately share a slot with a later live booking; uniqueness of *live* slots is an overlap rule, not a functional dependency.
- `BOOKING_APPROVALS`: `approval_id`, `booking_id` — both candidate keys.
- `UTILISATION_SNAPSHOTS`: `snapshot_id`, `(resource_id, period_start, period_end)` — both candidate keys.
- Reference tables: `*_id` and `*_code` (and `dept_name`) are candidate keys.

No determinant that is not a candidate key remains, so every table is in **BCNF**.

### 4.7 Deliberate non-normalised choices

- `FEATURES_JSON` holds a small, variable set of descriptive attributes (projector, GPU count). They are never joined or aggregated, so a JSON document validated by `IS JSON` is simpler than an EAV table.
- Booking duration and utilisation are **not stored**; they are derived by functions and views to avoid update anomalies. `UTILISATION_SNAPSHOTS` is an explicit, dated report output, not a cached copy of live data.

## 5. Business rules and where they live

| # | Rule | Database enforcement | API |
|---|---|---|---|
| 1 | No overlapping PENDING/APPROVED bookings | `SP_CREATE_BOOKING` (lock + check), `TRG_BOOKINGS_NO_OVERLAP` | maps -20005/-20017 to 409 |
| 2 | Valid start/end | `CK_BOOKINGS_INTERVAL`, procedure -20001, future start -20015 | zod refine |
| 3 | End later than start | `CK_BOOKINGS_INTERVAL` | zod |
| 4 | No booking under maintenance | procedure -20003, `TRG_BOOKINGS_BIU` | 409 |
| 5 | Only authorised roles approve | `SP_DECIDE_BOOKING` (role + department) | `requireRole` |
| 6 | Admin operations need permission | — | `requireRole('ADMIN')` |
| 7 | Cancellation frees the slot | overlap checks only consider PENDING/APPROVED | — |
| 8 | Changes are auditable | audit triggers; `TRG_AUDIT_LOGS_IMMUTABLE` | — |
| 9 | Capacity respected | procedure -20006, `TRG_BOOKINGS_BIU` | — |
| 10 | Meaningful errors | `RAISE_APPLICATION_ERROR(-200xx, text)` | `fromOracleError` |

## 6. Indexes

Oracle does not index foreign keys automatically; an unindexed FK forces full scans on joins and can escalate locking on the child table when a parent key is updated or deleted. Every FK is covered (verified by query V5 in `13_verification.sql`).

| Index | Serves |
|---|---|
| `IX_BOOKINGS_RES_TIME (resource_id, start_time, end_time)` | overlap check, calendar, utilisation |
| `IX_BOOKINGS_USER_START (requested_by, start_time)` | "My bookings" |
| `IX_BOOKINGS_STATUS_START (status, start_time)` | approval queue, dashboard counts |
| `IX_MAINT_STATUS_PRIORITY`, `IX_MAINT_RESOURCE` | maintenance board |
| `IX_AUDIT_RECORD (table_name, record_id)` | booking history |
| `IX_NOTIF_USER_READ (user_id, is_read, created_at)` | notification bell |
| remaining `IX_*` | foreign keys |

## 7. Objects created

- 13 tables, 9 views, 22 explicit indexes (plus those backing PK/UK constraints).
- 5 stand-alone functions (3 required + 2 helpers: FN_HOURS_BETWEEN, FN_CURRENT_ACTOR), 5 stand-alone procedures.
- 2 packages (specification + body).
- 9 triggers (6 row-level, 1 compound, 1 statement-level, 1 conditional `WHEN` row trigger).
