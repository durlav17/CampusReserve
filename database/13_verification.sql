--------------------------------------------------------------------------------
-- CampusReserve | 13_verification.sql
-- PURPOSE : Post-install verification and evidence queries. Read-only.
--           Screenshot each section for the report (EVIDENCE_CAPTURE_GUIDE.md).
--------------------------------------------------------------------------------
SET SERVEROUTPUT ON SIZE UNLIMITED
SET LINESIZE 200
SET PAGESIZE 100
COLUMN object_name FORMAT A32
COLUMN object_type FORMAT A16
COLUMN table_name  FORMAT A24
COLUMN constraint_name FORMAT A30
COLUMN trigger_name FORMAT A28
COLUMN resource_name FORMAT A28

PROMPT ===== V1. All CampusReserve code objects must be VALID =====
SELECT object_type, object_name, status
  FROM user_objects
 WHERE object_type IN ('FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY','TRIGGER','VIEW')
 ORDER BY object_type, object_name;

PROMPT ===== V2. Compilation errors (expect: no rows selected) =====
SELECT name, type, line, position, text FROM user_errors ORDER BY name, sequence;

PROMPT ===== V3. Row counts per table =====
SELECT 'ROLES' t, COUNT(*) n FROM roles UNION ALL
SELECT 'DEPARTMENTS', COUNT(*) FROM departments UNION ALL
SELECT 'USERS', COUNT(*) FROM users UNION ALL
SELECT 'BUILDINGS', COUNT(*) FROM buildings UNION ALL
SELECT 'RESOURCE_CATEGORIES', COUNT(*) FROM resource_categories UNION ALL
SELECT 'RESOURCES', COUNT(*) FROM resources UNION ALL
SELECT 'BOOKINGS', COUNT(*) FROM bookings UNION ALL
SELECT 'BOOKING_APPROVALS', COUNT(*) FROM booking_approvals UNION ALL
SELECT 'MAINTENANCE_REQUESTS', COUNT(*) FROM maintenance_requests UNION ALL
SELECT 'RESOURCE_BLACKOUTS', COUNT(*) FROM resource_blackouts UNION ALL
SELECT 'AUDIT_LOGS', COUNT(*) FROM audit_logs UNION ALL
SELECT 'NOTIFICATIONS', COUNT(*) FROM notifications UNION ALL
SELECT 'UTILISATION_SNAPSHOTS', COUNT(*) FROM utilisation_snapshots;

PROMPT ===== V4. Constraints by table and type (P=PK, R=FK, U=UNIQUE, C=CHECK/NOT NULL) =====
SELECT table_name,
       SUM(CASE constraint_type WHEN 'P' THEN 1 ELSE 0 END) AS pk,
       SUM(CASE constraint_type WHEN 'R' THEN 1 ELSE 0 END) AS fk,
       SUM(CASE constraint_type WHEN 'U' THEN 1 ELSE 0 END) AS uq,
       SUM(CASE WHEN constraint_type = 'C' AND constraint_name LIKE 'CK\_%' ESCAPE '\' THEN 1 ELSE 0 END) AS named_checks
  FROM user_constraints
 WHERE table_name NOT LIKE 'BIN$%' AND table_name <> 'BENCH_BOOKINGS'
 GROUP BY table_name
 ORDER BY table_name;

PROMPT ===== V5. Foreign keys without a supporting index (expect: no rows) =====
SELECT c.table_name, c.constraint_name, cc.column_name
  FROM user_constraints c
  JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name AND cc.position = 1
 WHERE c.constraint_type = 'R'
   AND NOT EXISTS (SELECT 1 FROM user_ind_columns ic
                    WHERE ic.table_name = c.table_name
                      AND ic.column_name = cc.column_name
                      AND ic.column_position = 1);

PROMPT ===== V6. Triggers =====
SELECT trigger_name, trigger_type, triggering_event, table_name, status
  FROM user_triggers ORDER BY table_name, trigger_name;

PROMPT ===== V7. Integrity: overlapping live bookings (expect: no rows) =====
SELECT a.resource_id, a.booking_id AS booking_a, b.booking_id AS booking_b
  FROM bookings a
  JOIN bookings b ON a.resource_id = b.resource_id AND a.booking_id < b.booking_id
 WHERE a.status IN ('PENDING','APPROVED') AND b.status IN ('PENDING','APPROVED')
   AND a.start_time < b.end_time AND a.end_time > b.start_time;

PROMPT ===== V8. Functions =====
SELECT b.booking_id, fn_booking_duration_hours(b.booking_id) AS hours
  FROM bookings b WHERE ROWNUM <= 3;
SELECT r.resource_code,
       fn_resource_utilisation(r.resource_id, TRUNC(SYSDATE) - 30, TRUNC(SYSDATE)) AS util_30d_pct,
       fn_resource_availability(r.resource_id,
            CAST(TRUNC(SYSDATE) + 25 AS TIMESTAMP) + INTERVAL '10' HOUR,
            CAST(TRUNC(SYSDATE) + 25 AS TIMESTAMP) + INTERVAL '11' HOUR) AS availability_day_plus_25
  FROM resources r ORDER BY r.resource_code;

PROMPT ===== V9. Views =====
SELECT resource_code, category_code, building_code, status, open_maintenance
  FROM v_resource_catalog ORDER BY resource_code;
SELECT * FROM v_resource_utilisation_30d ORDER BY utilisation_pct DESC FETCH FIRST 5 ROWS ONLY;
SELECT * FROM v_department_usage ORDER BY approved_hours DESC;
SELECT * FROM v_top_resources WHERE popularity_rank <= 5 ORDER BY popularity_rank;
SELECT booking_id, resource_code, requester_name, start_time, hours_waiting
  FROM v_pending_approvals ORDER BY start_time FETCH FIRST 5 ROWS ONLY;

PROMPT ===== V10. Packages: REF CURSOR output =====
VARIABLE rc REFCURSOR
EXEC :rc := pkg_resource_analytics.dashboard_summary;
PRINT rc
EXEC :rc := pkg_resource_analytics.top_resources(TRUNC(SYSDATE) - 30, TRUNC(SYSDATE), 5);
PRINT rc

PROMPT ===== V11. Pipelined slot generator (tomorrow, SJT-CR-302) =====
SELECT TO_CHAR(slot_start, 'HH24:MI') AS slot_from, TO_CHAR(slot_end, 'HH24:MI') AS slot_to,
       slot_state, booking_id
  FROM TABLE(pkg_campus_reservations.day_slots(
         (SELECT resource_id FROM resources WHERE resource_code = 'SJT-CR-302'), TRUNC(SYSDATE) + 1, 60));

PROMPT ===== V12. Cursor-based report (DBMS_OUTPUT) =====
EXEC pkg_resource_analytics.print_utilisation_report(TRUNC(SYSDATE) - 30, TRUNC(SYSDATE));

PROMPT ===== V13. Recent audit trail =====
SELECT audit_id, table_name, record_id, action, old_status, new_status, changed_by,
       TO_CHAR(changed_at, 'YYYY-MM-DD HH24:MI') AS changed_at
  FROM audit_logs ORDER BY audit_id DESC FETCH FIRST 10 ROWS ONLY;
