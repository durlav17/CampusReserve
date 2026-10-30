# Evidence Capture Guide

The faculty requires **every screenshot to come from your own execution**. The report contains clearly marked grey boxes reading **"EVIDENCE PLACEHOLDER"**. Replace each one with your own screenshot, then rebuild the PDF. Never submit the report with a placeholder still visible.

## 0. One-time setup (≈30 minutes)

1. Install **Oracle Database 23ai Free** (or any 19c+ database you have access to). The simplest route is the container image:
   ```bash
   docker run -d --name oracle-free -p 1521:1521 -e ORACLE_PWD=<StrongPassword1> container-registry.oracle.com/database/free:latest
   ```
   Or use the Windows/Linux installer, or Oracle Autonomous Database (see `DEPLOYMENT_GUIDE.md`).
2. Create the schema owner (as SYSTEM, in `FREEPDB1`):
   ```sql
   CREATE USER campus IDENTIFIED BY "<AppPassword1>" QUOTA UNLIMITED ON users;
   GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER, CREATE SEQUENCE TO campus;
   ```
3. Install **SQL Developer** or **SQLcl** for running the scripts.
4. Install **Node.js 20+**.
5. Set Windows/macOS display scaling so text in screenshots is readable; use light theme in SQL Developer.

Screenshot tips: crop to the relevant window, keep the command *and* its output visible, include the clock or a `SELECT SYSTIMESTAMP FROM dual` line where timing matters, save as PNG in `screenshots/` with the file names below.

## 1. Database evidence

| File name | Run | Capture |
|---|---|---|
| `fig07_run_all.png` | `@run_all.sql` | final lines including **"All objects VALID."** |
| `fig08_objects_valid.png` | `@13_verification.sql` section V1–V2 | object list with STATUS = VALID and "no rows selected" for errors |
| `fig08_constraints.png` | V4–V5 | constraint counts per table and the empty "FK without index" query |
| `fig08_functions.png` | V8 | function outputs |
| `fig08_refcursor.png` | V10 | `PRINT rc` output of `dashboard_summary` |
| `fig08_pipelined.png` | V11 | slot grid |
| `fig08_cursor_report.png` | V12 | DBMS_OUTPUT utilisation report |
| `fig10_test_suite_1.png`, `_2.png` | `@10_test_cases.sql` | all PASS/FAIL lines and the TOTAL line |
| `fig10_transactions.png` | `@12_transaction_tests.sql` | A1, A2, A3 lines |
| `fig10_two_sessions_locked.png` | Part B1 (two windows side by side) | B blocking, A COMMIT, B's ORA-20005 |
| `fig10_two_sessions_naive.png` | Part B2 | both sessions inserting, then the overlap query returning a row |
| `fig10_plan_before.png` | `@11_query_optimization.sql` | Q1 plan **before** (`TABLE ACCESS FULL`) |
| `fig10_plan_after.png` | same | Q1 plan **after** (`INDEX RANGE SCAN`) |
| `fig10_timings.png` | same | BEFORE and AFTER timing lines + the plan cost summary query |

Copy the numbers from the timing and cost output into **Tables 6.3 and 6.4** of the report (`report/CampusReserve_Report.tex`, search for `\pending`).

## 2. API evidence

```bash
cd backend
cp ../.env.example .env      # then fill DB_PASSWORD and JWT_SECRET
npm install
npm test                      # screenshot -> fig10_unit_tests.png
RUN_DB_TESTS=1 npm test       # screenshot -> fig10_integration_tests.png
node scripts/concurrency-experiment.js --sessions 10 --sleep 0.5   # screenshot -> fig10_concurrency.png
npm run dev                   # keep running for the UI
```

Keep the JSON file written to `backend/experiment-results/` and quote its numbers in Section 6.4 (Table 6.3) of the report. Run it at least three times and report every run (not just the most favourable one).

## 3. Front-end evidence

```bash
cd frontend
npm install
npm run dev     # open http://localhost:5173
```

Sign in with the synthetic accounts (password `Campus@2026`): `rohan.g@campusreserve.example` (student), `kiran.menon@…` (faculty), `coord.scope@…` (coordinator), `admin@…` (admin).

| File name | Screen | What should be visible |
|---|---|---|
| `fig09_login.png` | `/login` | sign-in card |
| `fig09_dashboard.png` | Overview as admin | KPI tiles and bookings chart |
| `fig09_resources.png` | Find a space | resource cards with filters |
| `fig09_calendar.png` | Availability | week grid with booked / pending / blocked chips |
| `fig09_new_booking.png` | New booking | green "This time is free" check and hourly strip |
| `fig09_conflict.png` | New booking on a taken slot | red conflict message returned by the database |
| `fig09_my_bookings.png` | My bookings | table with statuses |
| `fig09_booking_detail.png` | Booking detail | progress + trigger-written change history |
| `fig09_approvals.png` | Approvals as `coord.scope` | queue with Approve / Reject |
| `fig09_maintenance.png` | Maintenance | four-column board |
| `fig09_analytics.png` | Analytics as admin | utilisation chart, heat-map |
| `fig09_admin_resources.png`, `fig09_users.png`, `fig09_audit.png`, `fig09_profile.png` | admin pages | — |
| `fig09_mobile.png` | any page at 390 px wide (browser dev tools) | responsive layout |

## 4. Put the evidence into the report

In `report/CampusReserve_Report.tex` each placeholder looks like:

```latex
\evidence{fig09_dashboard.png}{Overview dashboard ...}
```

When the file `report/figures/evidence/fig09_dashboard.png` exists the macro shows the image; otherwise it shows the grey placeholder. So: copy your PNGs into `report/figures/evidence/`, then rebuild:

```bash
cd report
xelatex CampusReserve_Report.tex && xelatex CampusReserve_Report.tex   # twice for contents and cross-references
```

Then replace every `\pending{...}` in the testing tables with your observed result and PASS/FAIL, rebuild again, and check that the PDF contains no "EVIDENCE PLACEHOLDER" or "Pending" text:

```bash
pdftotext CampusReserve_Report.pdf - | grep -n -i -E "placeholder|pending" || echo "clean"
```

The DOCX is regenerated with `python3 build_docx.py` (see `report/README.md`).
