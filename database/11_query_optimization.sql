--------------------------------------------------------------------------------
-- CampusReserve | 11_query_optimization.sql   (TC-20 / Experiment E3)
-- PURPOSE : Reproducible before/after-index experiment.
--
-- METHOD
--   1. Build BENCH_BOOKINGS, a 300 000-row SYNTHETIC copy of the BOOKINGS
--      shape (200 resources x 2 years). It starts with no indexes at all, so
--      the "before" plans are honest full scans. The real BOOKINGS table is
--      not touched.
--   2. Gather optimiser statistics.
--   3. For three application queries, record EXPLAIN PLAN output and the
--      average elapsed time of 200 executions (DBMS_UTILITY.GET_TIME, 1/100 s).
--   4. Create the same indexes the application uses, re-gather statistics,
--      repeat step 3.
--   5. Copy the printed numbers into the report. DO NOT invent figures.
--
-- PRIVILEGES: only CREATE TABLE and the default PLAN_TABLE are needed.
--   Optional (richer evidence): DBMS_XPLAN.DISPLAY_CURSOR with ALLSTATS LAST
--   needs SELECT on V$SQL_PLAN_STATISTICS_ALL etc. (e.g. SELECT_CATALOG_ROLE).
-- RUNTIME : about 1-3 minutes on Oracle Database Free.
--------------------------------------------------------------------------------
SET SERVEROUTPUT ON SIZE UNLIMITED
SET DEFINE OFF
SET LINESIZE 200
SET PAGESIZE 200

-- 0. Clean start ------------------------------------------------------------------
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE bench_bookings PURGE';
EXCEPTION WHEN OTHERS THEN IF SQLCODE <> -942 THEN RAISE; END IF;
END;
/

-- 1. Synthetic data (labelled as such) ----------------------------------------------
CREATE TABLE bench_bookings AS
WITH a AS (SELECT LEVEL AS n FROM dual CONNECT BY LEVEL <= 600),
     b AS (SELECT LEVEL AS n FROM dual CONNECT BY LEVEL <= 500),
     g AS (SELECT (a.n - 1) * 500 + b.n AS rn FROM a CROSS JOIN b)
SELECT rn                                                         AS booking_id,
       MOD(rn, 200) + 1                                           AS resource_id,
       MOD(rn * 7, 5000) + 1                                      AS requested_by,
       'Synthetic benchmark booking ' || rn                       AS title,
       CASE MOD(rn, 10) WHEN 0 THEN 'PENDING' WHEN 1 THEN 'CANCELLED'
                        WHEN 2 THEN 'REJECTED' ELSE 'APPROVED' END AS status,
       TIMESTAMP '2025-01-01 00:00:00'
         + NUMTODSINTERVAL(MOD(TRUNC(rn / 200), 730), 'DAY')
         + NUMTODSINTERVAL(8 + MOD(TRUNC(rn / 146000), 2) * 2 + MOD(rn, 3) * 4, 'HOUR') AS start_time,
       CAST(NULL AS TIMESTAMP)                                    AS end_time
FROM g;

UPDATE bench_bookings SET end_time = start_time + INTERVAL '2' HOUR;
COMMIT;

BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'BENCH_BOOKINGS', method_opt => 'FOR ALL COLUMNS SIZE AUTO');
END;
/

SELECT COUNT(*) AS bench_rows, COUNT(DISTINCT resource_id) AS resources,
       MIN(start_time) AS first_start, MAX(start_time) AS last_start
FROM bench_bookings;

-- 2. Timing harness ---------------------------------------------------------------------
-- Q1 overlap check   (SP_CREATE_BOOKING)
-- Q2 user history    ("My bookings" page)
-- Q3 approval queue  (pending bookings in the next 30 days of the data set)
CREATE OR REPLACE PROCEDURE bench_run (p_label IN VARCHAR2) AUTHID CURRENT_USER IS
    c_runs CONSTANT PLS_INTEGER := 200;
    v_t0   PLS_INTEGER;
    v_n    NUMBER;
    v_ms   NUMBER;
    PROCEDURE run_one (p_name VARCHAR2, p_sql VARCHAR2) IS
    BEGIN
        v_t0 := DBMS_UTILITY.GET_TIME;
        FOR i IN 1 .. c_runs LOOP
            -- Vary the bind so every run is a real lookup, not a cached result.
            EXECUTE IMMEDIATE p_sql INTO v_n USING MOD(i * 37, 200) + 1;
        END LOOP;
        v_ms := (DBMS_UTILITY.GET_TIME - v_t0) * 10 / c_runs;
        DBMS_OUTPUT.PUT_LINE(RPAD(p_label, 8) || RPAD(p_name, 22) || 'avg '
                             || TO_CHAR(v_ms, '99990.00') || ' ms over ' || c_runs || ' runs');
    END;
BEGIN
    run_one('Q1 overlap check',
        'SELECT COUNT(*) FROM bench_bookings WHERE resource_id = :r '
     || 'AND status IN (''PENDING'',''APPROVED'') '
     || 'AND start_time < TIMESTAMP ''2026-03-10 12:00:00'' '
     || 'AND end_time   > TIMESTAMP ''2026-03-10 10:00:00''');
    run_one('Q2 user history',
        'SELECT COUNT(*) FROM bench_bookings WHERE requested_by = :u * 25 '
     || 'AND start_time >= TIMESTAMP ''2026-01-01 00:00:00''');
    run_one('Q3 approval queue',
        'SELECT COUNT(*) FROM bench_bookings WHERE status = ''PENDING'' '
     || 'AND start_time >= TIMESTAMP ''2026-06-01 00:00:00'' + NUMTODSINTERVAL(:d, ''HOUR'') '
     || 'AND start_time <  TIMESTAMP ''2026-07-01 00:00:00''');
END bench_run;
/

-- 3. BEFORE indexes --------------------------------------------------------------------
PROMPT ===== BEFORE INDEXING: execution plans =====
EXPLAIN PLAN SET STATEMENT_ID = 'Q1_BEFORE' FOR
SELECT COUNT(*) FROM bench_bookings
 WHERE resource_id = 42 AND status IN ('PENDING','APPROVED')
   AND start_time < TIMESTAMP '2026-03-10 12:00:00'
   AND end_time   > TIMESTAMP '2026-03-10 10:00:00';
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'Q1_BEFORE', 'TYPICAL'));

EXPLAIN PLAN SET STATEMENT_ID = 'Q2_BEFORE' FOR
SELECT COUNT(*) FROM bench_bookings
 WHERE requested_by = 1050 AND start_time >= TIMESTAMP '2026-01-01 00:00:00';
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'Q2_BEFORE', 'TYPICAL'));

EXPLAIN PLAN SET STATEMENT_ID = 'Q3_BEFORE' FOR
SELECT COUNT(*) FROM bench_bookings
 WHERE status = 'PENDING'
   AND start_time >= TIMESTAMP '2026-06-01 00:00:00'
   AND start_time <  TIMESTAMP '2026-07-01 00:00:00';
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'Q3_BEFORE', 'TYPICAL'));

PROMPT ===== BEFORE INDEXING: timings =====
EXEC bench_run('BEFORE');

-- 4. Create the application's indexes on the benchmark table ---------------------------
CREATE INDEX ix_bench_res_time     ON bench_bookings (resource_id, start_time, end_time);
CREATE INDEX ix_bench_user_start   ON bench_bookings (requested_by, start_time);
CREATE INDEX ix_bench_status_start ON bench_bookings (status, start_time);
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'BENCH_BOOKINGS', cascade => TRUE);
END;
/

-- 5. AFTER indexes ---------------------------------------------------------------------
PROMPT ===== AFTER INDEXING: execution plans =====
EXPLAIN PLAN SET STATEMENT_ID = 'Q1_AFTER' FOR
SELECT COUNT(*) FROM bench_bookings
 WHERE resource_id = 42 AND status IN ('PENDING','APPROVED')
   AND start_time < TIMESTAMP '2026-03-10 12:00:00'
   AND end_time   > TIMESTAMP '2026-03-10 10:00:00';
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'Q1_AFTER', 'TYPICAL'));

EXPLAIN PLAN SET STATEMENT_ID = 'Q2_AFTER' FOR
SELECT COUNT(*) FROM bench_bookings
 WHERE requested_by = 1050 AND start_time >= TIMESTAMP '2026-01-01 00:00:00';
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'Q2_AFTER', 'TYPICAL'));

EXPLAIN PLAN SET STATEMENT_ID = 'Q3_AFTER' FOR
SELECT COUNT(*) FROM bench_bookings
 WHERE status = 'PENDING'
   AND start_time >= TIMESTAMP '2026-06-01 00:00:00'
   AND start_time <  TIMESTAMP '2026-07-01 00:00:00';
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', 'Q3_AFTER', 'TYPICAL'));

PROMPT ===== AFTER INDEXING: timings =====
EXEC bench_run('AFTER');

-- 6. Plan cost summary for the report table -------------------------------------------
SELECT statement_id, operation || ' ' || options AS top_access, object_name, cost, cardinality
  FROM plan_table
 WHERE statement_id IN ('Q1_BEFORE','Q1_AFTER','Q2_BEFORE','Q2_AFTER','Q3_BEFORE','Q3_AFTER')
   AND operation IN ('TABLE ACCESS', 'INDEX')
 ORDER BY statement_id, id;

-- 7. Optional, privileged: actual row-source statistics -----------------------------------
-- SELECT /*+ GATHER_PLAN_STATISTICS */ COUNT(*) FROM bench_bookings WHERE resource_id = 42
--    AND status IN ('PENDING','APPROVED')
--    AND start_time < TIMESTAMP '2026-03-10 12:00:00' AND end_time > TIMESTAMP '2026-03-10 10:00:00';
-- SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));

-- 8. Clean up (comment out to keep the table for screenshots) --------------------------
-- DROP PROCEDURE bench_run;
-- DROP TABLE bench_bookings PURGE;
