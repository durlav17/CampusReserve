--------------------------------------------------------------------------------
-- CampusReserve | run_all.sql
-- Rebuilds the whole schema in the correct order. Run as the application
-- schema owner (NOT as SYS/SYSTEM) from this directory:
--     sql campus/<password>@localhost:1521/FREEPDB1 @run_all.sql
-- or in SQL Developer: open run_all.sql and press F5.
--------------------------------------------------------------------------------
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
SET ECHO ON
SET SERVEROUTPUT ON SIZE UNLIMITED

@@00_reset_dev.sql
@@01_create_schema.sql
@@02_constraints_indexes.sql
@@03_seed_data.sql
@@04_views.sql
@@05_functions.sql
@@06_procedures.sql
@@07_package_specifications.sql
@@08_package_bodies.sql
@@09_triggers.sql

-- PL/SQL compile errors do not raise SQLERROR, so check explicitly.
SET ECHO OFF
PROMPT Checking for invalid objects...
DECLARE
    v_bad NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_bad FROM user_objects WHERE status <> 'VALID';
    IF v_bad > 0 THEN
        FOR e IN (SELECT name, type, line, text FROM user_errors ORDER BY name, sequence) LOOP
            DBMS_OUTPUT.PUT_LINE(e.type || ' ' || e.name || ' line ' || e.line || ': ' || e.text);
        END LOOP;
        RAISE_APPLICATION_ERROR(-20999, v_bad || ' invalid object(s) - see messages above.');
    END IF;
    DBMS_OUTPUT.PUT_LINE('All objects VALID.');
END;
/
WHENEVER SQLERROR CONTINUE
PROMPT Schema installed. Next: @10_test_cases.sql, @12_transaction_tests.sql, @11_query_optimization.sql, @13_verification.sql
