--------------------------------------------------------------------------------
-- CampusReserve | 00_reset_dev.sql
-- PURPOSE : Drop every CampusReserve object so the schema can be rebuilt from
--           scratch. DEVELOPMENT USE ONLY - never run against production data.
-- COMPAT  : Oracle Database 19c and later (no 23ai-only "DROP ... IF EXISTS").
-- AUTHOR  : Durlav Dani (24BCE2361) - individual BCSE302P mini project
--------------------------------------------------------------------------------
SET SERVEROUTPUT ON
SET DEFINE OFF

DECLARE
    TYPE t_names IS TABLE OF VARCHAR2(128);
    -- Child tables first so foreign keys never block a drop.
    v_tables t_names := t_names(
        'BENCH_BOOKINGS', 'UTILISATION_SNAPSHOTS', 'NOTIFICATIONS', 'AUDIT_LOGS',
        'RESOURCE_BLACKOUTS', 'MAINTENANCE_REQUESTS', 'BOOKING_APPROVALS',
        'BOOKINGS', 'RESOURCES', 'RESOURCE_CATEGORIES', 'BUILDINGS', 'USERS',
        'DEPARTMENTS', 'ROLES');
    v_code_objects t_names := t_names(
        'PACKAGE PKG_RESOURCE_ANALYTICS', 'PACKAGE PKG_CAMPUS_RESERVATIONS',
        'PROCEDURE SP_CREATE_BOOKING', 'PROCEDURE SP_DECIDE_BOOKING',
        'PROCEDURE SP_CANCEL_BOOKING', 'PROCEDURE SP_SUBMIT_MAINTENANCE',
        'PROCEDURE SP_UPDATE_MAINTENANCE_STATUS',
        'FUNCTION FN_BOOKING_DURATION_HOURS', 'FUNCTION FN_RESOURCE_UTILISATION',
        'FUNCTION FN_RESOURCE_AVAILABILITY', 'FUNCTION FN_HOURS_BETWEEN',
        'FUNCTION FN_CURRENT_ACTOR', 'PROCEDURE BENCH_RUN');
    v_views t_names := t_names(
        'V_RESOURCE_CATALOG', 'V_BOOKING_DETAILS', 'V_PENDING_APPROVALS',
        'V_ACTIVE_BOOKINGS', 'V_MAINTENANCE_DASHBOARD', 'V_RESOURCE_UTILISATION_30D',
        'V_DEPARTMENT_USAGE', 'V_BOOKING_TREND_DAILY', 'V_TOP_RESOURCES');

    PROCEDURE try_exec(p_sql VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE p_sql;
        DBMS_OUTPUT.PUT_LINE('OK   : ' || p_sql);
    EXCEPTION
        WHEN OTHERS THEN
            -- ORA-00942 (table/view missing) and ORA-04043 (object missing) are expected.
            IF SQLCODE IN (-942, -4043, -2289) THEN
                DBMS_OUTPUT.PUT_LINE('SKIP : ' || p_sql);
            ELSE
                RAISE;
            END IF;
    END;
BEGIN
    FOR i IN 1 .. v_views.COUNT LOOP
        try_exec('DROP VIEW ' || v_views(i));
    END LOOP;
    FOR i IN 1 .. v_code_objects.COUNT LOOP
        try_exec('DROP ' || v_code_objects(i));
    END LOOP;
    FOR i IN 1 .. v_tables.COUNT LOOP
        try_exec('DROP TABLE ' || v_tables(i) || ' CASCADE CONSTRAINTS PURGE');
    END LOOP;
END;
/
