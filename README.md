# CampusReserve

**Intelligent Campus Resource Booking, Maintenance & Utilisation Analytics System**

Individual mini project for **BCSE302P – Database Systems Lab** (VIT Vellore, Fall Semester 2026–27)
by **Durlav Dani (24BCE2361)**, School of Computer Science and Engineering.

CampusReserve lets students, faculty, coordinators and administrators book laboratories, seminar halls, classrooms and equipment, report faults, approve requests and study utilisation. Its central technical idea is that **the database guarantees no two people can hold the same resource at overlapping times**, even when their requests arrive at the same instant: every booking goes through a PL/SQL procedure that locks the resource row before checking for overlaps.

> All people, bookings and tickets in the seed data are **synthetic**. No AI/ML feature is claimed; "intelligent" refers to rule-based checks and database analytics.

## Architecture

```
React + TypeScript (Netlify)  →  Express REST API (Render)  →  Oracle Database 19c+ / Autonomous DB
     Tailwind, Recharts             JWT, RBAC, zod, helmet          13 tables, 9 views, 5 functions,
                                    one transaction per request      5 procedures, 2 packages, 9 triggers
```

Diagrams: `documentation/diagrams/` (Mermaid source) and `report/figures/` (PNG).

## Repository layout

```
database/        00–13 numbered SQL/PL-SQL scripts + run_all.sql
backend/         Express API (src/), tests/, scripts/concurrency-experiment.js
frontend/        React app (src/pages, src/components, src/hooks, src/services)
documentation/   design, API, testing, deployment, research, evidence guides, submission e-mail
report/          LaTeX source, PDF, DOCX, figures, DOCX build script
screenshots/     your own execution evidence
```

## Prerequisites

- Oracle Database 19c or later (Oracle Database 23ai Free locally, or Autonomous Database)
- SQL Developer or SQLcl
- Node.js 20+ (CI uses 22)
- For the report: TeX Live with XeLaTeX; pandoc + python-docx for the DOCX

## Quick start (local)

```bash
# 1. Database — as SYSTEM create the schema owner, then install as that user
#    CREATE USER campus IDENTIFIED BY "<pwd>" QUOTA UNLIMITED ON users;
#    GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER, CREATE SEQUENCE TO campus;
cd database
sql campus/<pwd>@localhost:1521/FREEPDB1 @run_all.sql

# 2. API
cd ../backend
cp .env.example .env          # set DB_PASSWORD (and JWT_SECRET)
npm install
npm run dev                   # http://localhost:4000/api/health

# 3. Front end
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

Demo accounts (synthetic, password `Campus@2026`): `rohan.g@campusreserve.example` (student), `kiran.menon@campusreserve.example` (faculty), `coord.scope@campusreserve.example` (coordinator, SCOPE), `admin@campusreserve.example` (administrator). Change or disable them before any real deployment.

## Database objects

| Kind | Objects |
|---|---|
| Functions | `fn_booking_duration_hours`, `fn_resource_utilisation`, `fn_resource_availability` (+ helpers `fn_hours_between`, `fn_current_actor`) |
| Procedures | `sp_create_booking` (row lock + overlap check), `sp_decide_booking`, `sp_cancel_booking`, `sp_submit_maintenance`, `sp_update_maintenance_status` |
| Packages | `pkg_campus_reservations` (pipelined `day_slots`, REF-cursor schedule, explicit-cursor digest and expiry), `pkg_resource_analytics` (dashboard, trends, utilisation, cursor reports) |
| Triggers | validation and state machines, compound overlap trigger, audit triggers, append-only audit log |
| Views | catalogue, booking details, approval queue, utilisation, department usage, trends, ranking |

Details: `documentation/DATABASE_DESIGN.md`. API reference: `documentation/API_DOCUMENTATION.md`.

## Tests

```bash
cd backend && npm test                              # 25 unit/HTTP tests, no database needed
RUN_DB_TESTS=1 DB_PASSWORD=<pwd> npm test           # + integration tests against Oracle
node scripts/concurrency-experiment.js --sessions 10
cd ../database && sql campus/<pwd>@... @10_test_cases.sql   # self-checking PASS/FAIL suite
```

See `documentation/TESTING_GUIDE.md`. **Status:** the API unit tests, linting, type checks and the production build have been run; the Oracle-dependent suites have **not** been executed yet because no Oracle instance was available in the build environment. Their results are marked *Pending* in the report until you run them.

## Deployment

Netlify (front end, `netlify.toml`), Render (API, `render.yaml`), Oracle Autonomous Database. Step-by-step instructions, including TLS connection strings and environment variables: `documentation/DEPLOYMENT_GUIDE.md`. Nothing has been deployed yet.

## Environment variables

See `.env.example`. Never commit `.env` files, wallets or passwords.

## Screenshots

Add your own screenshots to `screenshots/` following `documentation/EVIDENCE_CAPTURE_GUIDE.md`.

## Known limitations

- Bookings must start and end on the same day; no recurring bookings.
- Overlap prevention for concurrent requests relies on writers using `sp_create_booking`; the compound trigger is a best-effort backstop for other writers.
- In-app notifications only (no e-mail).
- JWT stored in `sessionStorage`.

## Licence

MIT — see `LICENSE`. Individual academic project; no other contributors.
