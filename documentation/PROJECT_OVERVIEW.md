# CampusReserve: Project Overview

**CampusReserve: Intelligent Campus Resource Booking, Maintenance & Utilisation Analytics System**
Individual mini project for **BCSE302P Database Systems Lab**, Fall Semester 2026–27.
Student: **Durlav Dani**, Registration Number **24BCE2361**, School of Computer Science and Engineering (SCOPE).

## Problem

Shared campus resources (laboratories, seminar halls, classrooms, auditoriums and portable equipment) are usually booked through e-mail threads or spreadsheets. These tools cannot stop two people from reserving the same room for overlapping times, do not enforce booking rules, lose the history of who changed what, and give no reliable picture of how much each resource is actually used.

## Technical question

> How can relational database integrity constraints, row-level locking and indexing improve correctness and performance in shared-resource reservation systems?

The project answers this by putting the rules inside Oracle (constraints, triggers and stored procedures that hold a row lock), keeping the web tier thin, and measuring the effect of indexes with execution plans.

## What the system does

| Capability | Where it is enforced |
|---|---|
| Registration, sign-in, roles (student, faculty, coordinator, admin) | Express API (bcrypt, JWT, RBAC) + `ROLES` table |
| Browse and search resources | `V_RESOURCE_CATALOG` view |
| Week calendar and hourly slots | `PKG_CAMPUS_RESERVATIONS.RESOURCE_SCHEDULE` (REF CURSOR), `DAY_SLOTS` (pipelined) |
| Create a booking without double-booking | `SP_CREATE_BOOKING` (row lock + overlap check), `TRG_BOOKINGS_NO_OVERLAP` (defence in depth) |
| Approve / reject / cancel | `SP_DECIDE_BOOKING`, `SP_CANCEL_BOOKING`, status state machine in `TRG_BOOKINGS_BIU` |
| Maintenance tickets that take a room out of service | `SP_SUBMIT_MAINTENANCE`, `SP_UPDATE_MAINTENANCE_STATUS`, `TRG_MAINTENANCE_BIU` |
| Audit history | `TRG_BOOKINGS_AUDIT`, `TRG_MAINTENANCE_AUDIT`, `TRG_RESOURCES_STATUS_AUDIT`, append-only `AUDIT_LOGS` |
| Utilisation analytics and reports | `FN_RESOURCE_UTILISATION`, `PKG_RESOURCE_ANALYTICS`, analytic views |

No artificial-intelligence or machine-learning component is claimed. "Intelligent" refers to rule-based scheduling checks and database analytics only.

## Repository map

```
CampusReserve/
├── database/        Oracle SQL and PL/SQL scripts 00–13 + run_all.sql
├── backend/         Node.js + Express REST API (node-oracledb Thin mode)
├── frontend/        React + TypeScript + Vite + Tailwind single-page app
├── documentation/   design, API, testing, deployment, research, evidence guides, diagrams
├── report/          LaTeX source, generated PDF and DOCX, figures
├── screenshots/     your own execution evidence goes here
├── .github/         CI workflow (lint, unit tests, build)
├── netlify.toml, render.yaml, .env.example, README.md, LICENSE
```

## Status at packaging time

- All code, SQL and documentation are written.
- Backend unit tests (25) pass; frontend type-checks, lints with no errors and builds.
- **The Oracle scripts have not been executed in the build environment** because no Oracle instance could be obtained there. Every database test, execution plan and timing is therefore marked *pending* until you run it. See `TESTING_GUIDE.md` and `EVIDENCE_CAPTURE_GUIDE.md`.
- Nothing has been deployed to Netlify or Render; `DEPLOYMENT_GUIDE.md` lists the steps you must perform.
