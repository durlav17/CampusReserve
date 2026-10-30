# Research Methodology

## Research question

> How can relational database integrity constraints, row-level locking and indexing improve correctness and performance in shared-resource reservation systems?

## Hypotheses

- **H1 (correctness).** A booking path that checks for overlaps *after* acquiring a row-level lock on the resource never commits overlapping live bookings, whereas a check-then-insert path without a lock can, under concurrent load.
- **H2 (integrity).** Declarative constraints and triggers reject invalid data (bad intervals, dangling references, illegal status changes) regardless of which client issues the SQL.
- **H3 (performance).** Composite B-tree indexes on `(resource_id, start_time, end_time)`, `(requested_by, start_time)` and `(status, start_time)` change the optimiser's plan for the three most frequent application queries from full table scans to index range scans and reduce their elapsed time on a large table.

## Experiments

| ID | Experiment | Script | Measured | Pass criterion |
|---|---|---|---|---|
| E1 | Booking-conflict prevention (single session) | `10_test_cases.sql` TC-05, 06, 06b, 18h | error codes, adjacent-slot acceptance | overlap → ORA-20005; touching intervals accepted; raw overlapping insert → ORA-20017 |
| E2 | Simultaneous booking attempts | `scripts/concurrency-experiment.js`, `12_transaction_tests.sql` Part B | successes per mode, live rows in the slot | locked: exactly 1; naive: report observed value |
| E3 | Execution plans before/after indexing | `11_query_optimization.sql` | plan operation, optimiser cost, avg ms over 200 runs | qualitative plan change; report measured ratios only |
| E4 | Utilisation analytics | TC-16, `PKG_RESOURCE_ANALYTICS` | function vs independent SQL | identical values |
| E5 | Referential integrity / invalid data | TC-17, TC-18 series | Oracle error codes | ORA-02291, ORA-02290, ORA-00001 |
| E6 | Transaction rollback and failure handling | TC-19, `12_transaction_tests.sql` Part A | row counts, resource status before/after | unchanged after rollback |

## Environment to record

Fill this in from your own machine before reporting E2/E3 numbers:

- Oracle edition and version: `SELECT banner_full FROM v$version;` (or `banner` on 19c)
- Host CPU / RAM, OS
- Node.js version (`node -v`), node-oracledb version (`npm ls oracledb`)
- Whether the database was local (container) or Autonomous Database (network latency matters for E2 elapsed time).

## Data

- Application data: `03_seed_data.sql`, **synthetic**, deterministic, dated relative to `SYSDATE`.
- Benchmark data: `BENCH_BOOKINGS`, **synthetic**, 300 000 rows over 200 resources and two years, generated with `CONNECT BY`. It has the same shape as `BOOKINGS` but no constraints, so index effects are isolated.

## Procedure for E3

1. Build the table and gather statistics (`DBMS_STATS`).
2. For each query capture `EXPLAIN PLAN` + `DBMS_XPLAN.DISPLAY`.
3. Execute each query 200 times with varying bind values; average elapsed time from `DBMS_UTILITY.GET_TIME` (centisecond resolution, so per-execution averages under ~0.05 ms are at the limit of resolution — say so if you see 0.00).
4. Create the indexes, re-gather statistics, repeat 2–3.
5. Run the whole script three times; report the median and the range.

## Threats to validity

- **Caching.** The second run benefits from a warm buffer cache. The script runs BEFORE and AFTER in the same session; repeat the full script and compare like with like.
- **Timer resolution.** `GET_TIME` is 1/100 s; that is why the harness times 200 executions together.
- **Synthetic distribution.** Uniform data favours indexes on selective columns; real bookings cluster around popular rooms and hours.
- **E2 timing.** The naive race is probabilistic; with a short sleep some sessions may see an earlier commit and fail via the trigger. Report all outcomes, including any trigger errors (ORA-20017) — they show the trigger catching late arrivals but not the true race.
- **Scale.** A single-instance Oracle Free database is not representative of production concurrency; conclusions concern correctness, not throughput.

## Reporting rules

- Only numbers you measured go in the report. Leave the `\pending{}` markers until you have them.
- Report every run, not the best one.
- State the environment next to every table of measurements.
