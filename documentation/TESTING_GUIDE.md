# Testing Guide

## What has and has not been executed

| Suite | Location | Needs Oracle | Status at packaging (30 Oct 2026) |
|---|---|---|---|
| API unit / HTTP-layer tests (25) | `backend/tests/unit.test.js` | No | **Executed in the build environment: 25 passed, 0 failed** |
| Backend lint (ESLint) | `backend/` | No | Executed: 0 problems |
| Frontend type check, lint, production build | `frontend/` | No | Executed: type check clean, 0 lint errors (style warnings only), build succeeded |
| Database functional suite (TC-04…TC-22) | `database/10_test_cases.sql` | Yes | **Not executed** – no Oracle instance was reachable from the build environment |
| Transaction / rollback tests (Part A) and two-session protocol (Part B) | `database/12_transaction_tests.sql` | Yes | **Not executed** |
| Execution-plan experiment | `database/11_query_optimization.sql` | Yes | **Not executed** |
| API integration suite against Oracle | `backend/tests/integration.test.js` | Yes | **Not executed** (skips unless `RUN_DB_TESTS=1`) |
| Concurrency experiment E2 | `backend/scripts/concurrency-experiment.js` | Yes | **Not executed** |

Nothing in this repository claims a database test passed. Fill the *Actual* and *Status* columns below only from your own runs, and keep the screenshot or log file referenced in *Evidence*.

## How to run

```bash
# 1. Database (as the CAMPUS schema owner)
cd database
sql campus/<password>@localhost:1521/FREEPDB1 @run_all.sql
sql campus/<password>@localhost:1521/FREEPDB1 @10_test_cases.sql
sql campus/<password>@localhost:1521/FREEPDB1 @12_transaction_tests.sql
sql campus/<password>@localhost:1521/FREEPDB1 @11_query_optimization.sql
sql campus/<password>@localhost:1521/FREEPDB1 @13_verification.sql

# 2. API tests
cd ../backend
npm test                                   # unit tests, no database
RUN_DB_TESTS=1 DB_PASSWORD=<password> npm test   # adds the integration suite
node scripts/concurrency-experiment.js --sessions 10 --sleep 0.5

# 3. Frontend
cd ../frontend
npx tsc -b && npm run lint && npm run build
```

`10_test_cases.sql` prints one `PASS`/`FAIL` line per case and rolls everything back, so it can be re-run.

## Test cases

Columns *Actual* and *Status* are intentionally left as **Pending** for database-dependent cases.

| ID | Objective | Preconditions | Input | Steps | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| TC-01 | Successful registration | API + DB running | new e-mail, valid password, deptId | `POST /auth/register` (integration test) | 201, role STUDENT, token issued | Pending | Not executed | Report ch. 6 |
| TC-02 | Successful login | seeded user | `rohan.g@…` / `Campus@2026` | `POST /auth/login`; UI sign-in | 200 + token; dashboard opens | Pending | Not executed | Report ch. 6 |
| TC-03 | Invalid login | — | wrong password | `POST /auth/login` | 401 `INVALID_CREDENTIALS`, generic message | Pending | Not executed | Report ch. 6 |
| TC-04 | Resource creation | admin | `TEST-RES-01` | `10_test_cases.sql` / `POST /resources` | row created, status defaults to AVAILABLE | Pending | Not executed | Report ch. 6 |
| TC-05 | Successful booking | lab free on test day | 10:00–12:00, 30 attendees | `SP_CREATE_BOOKING` | id returned, status PENDING, duration 2 h | Pending | Not executed | Report ch. 6 |
| TC-06 | Overlap rejected | TC-05 booking exists | 11:00–13:00 same lab | `SP_CREATE_BOOKING` | ORA-20005 / HTTP 409; adjacent 12:00–14:00 accepted (TC-06b) | Pending | Not executed | Report ch. 6 |
| TC-07 | Simultaneous attempts | empty slot | 10 parallel sessions | `concurrency-experiment.js`; `12_transaction_tests.sql` Part B | locked mode: exactly 1 success; naive mode: record observed count | Pending | Not executed | Report ch. 6, JSON log |
| TC-08 | Approval | PENDING booking, coordinator of managing dept | `APPROVED` | `SP_DECIDE_BOOKING` | status APPROVED, one approval row; re-decision → ORA-20011 | Pending | Not executed | Report ch. 6 |
| TC-09 | Rejection | PENDING booking | `REJECTED` + reason | `SP_DECIDE_BOOKING` | status REJECTED; slot available again | Pending | Not executed | Report ch. 6 |
| TC-10 | Cancellation | own booking | reason | `SP_CANCEL_BOOKING` | CANCELLED, slot free; other student's cancel → ORA-20012 | Pending | Not executed | Report ch. 6 |
| TC-11 | Booking a resource under maintenance | `SMV-LAB-220` in MAINTENANCE | any slot | `SP_CREATE_BOOKING` | ORA-20003 / HTTP 409 | Pending | Not executed | Report ch. 6 |
| TC-12 | Unauthorised admin / approval | student token | approve, `/users`, `POST /resources` | procedure + API | ORA-20012; HTTP 403 | API layer: **passed in unit tests**; DB layer: Pending | Partly executed | unit test log, report ch. 6 |
| TC-13 | Maintenance ticket creation | faculty | blocking ticket on hall | `SP_SUBMIT_MAINTENANCE` | ticket OPEN, resource MAINTENANCE, holders notified; student blocking → ORA-20012 | Pending | Not executed | Report ch. 6 |
| TC-14 | Maintenance status update | TC-13 ticket | IN_PROGRESS → RESOLVED | `SP_UPDATE_MAINTENANCE_STATUS` | ticket RESOLVED, `resolved_at` set, resource AVAILABLE; CLOSED→OPEN → ORA-20011 | Pending | Not executed | Report ch. 6 |
| TC-15 | Audit log generation | TC-13/14 done | — | query `AUDIT_LOGS`; try DELETE | ≥4 ticket rows, ≥2 resource status rows; DELETE → ORA-20012 | Pending | Not executed | Report ch. 6 |
| TC-16 | Utilisation calculation | seeded history | last 30 days | compare function vs independent SQL | equal values | Pending | Not executed | Report ch. 6 |
| TC-17 | Invalid FK insert | — | `requested_by = -999` | raw INSERT | ORA-02291 | Pending | Not executed | Report ch. 6 |
| TC-18 | Constraint violations | — | end < start; duplicate e-mail (case-insensitive); capacity; hours; blackout; idempotent retry; raw overlapping insert | 10_test_cases TC-18…18h | ORA-02290, ORA-00001, -20006, -20008, -20007, same id returned, -20017 | Pending | Not executed | Report ch. 6 |
| TC-19 | Transaction rollback | — | create then `ROLLBACK TO SAVEPOINT` | TC-19 + `12_transaction_tests.sql` A1–A3 | row counts unchanged; whole unit rolled back | Pending | Not executed | Report ch. 6 |
| TC-20 | Index execution plans | — | 300 000 synthetic rows | `11_query_optimization.sql` | before: `TABLE ACCESS FULL`; after: `INDEX RANGE SCAN`; record costs and timings | Pending | Not executed | Report ch. 6 |
| TC-21 | Cursor procedures | seeded data | — | digest, snapshot, escalation, expiry | counts printed; snapshot rows = resources | Pending | Not executed | Report ch. 6 |
| TC-22 | Pipelined slots | — | classroom, 60-min slots | `DAY_SLOTS` | 12 slots for 08:00–20:00 | Pending | Not executed | Report ch. 6 |

## Executed API unit tests (build environment)

`npm test` in `backend/` on Node.js 22 — 25 tests, 25 passed. They cover Oracle error mapping, validation schemas (interval order, offset-less timestamps rejected, password rules, MAINTENANCE status not settable by hand), JWT handling (missing / tampered / valid token), role checks (student → 403 on admin, approval and all-bookings endpoints), malformed JSON, security headers and the health endpoint reporting `503` without a database. Re-run them yourself and screenshot the terminal for the report.
