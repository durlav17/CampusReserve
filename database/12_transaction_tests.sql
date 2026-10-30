--------------------------------------------------------------------------------
-- CampusReserve | 12_transaction_tests.sql   (TC-07, TC-19 / Experiments E2, E6)
-- PURPOSE : Transaction management, rollback and concurrency experiments.
--
--   PART A  single session  - run this file as a script; everything rolls back.
--   PART B  two sessions    - follow the step-by-step protocol in the comments
--                             using two SEPARATE connections (two SQL*Plus
--                             windows, or two SQL Developer "unshared" worksheets).
--   An automated version of Part B (N parallel connections) is
--   backend/scripts/concurrency-experiment.js.
--------------------------------------------------------------------------------
SET SERVEROUTPUT ON SIZE UNLIMITED
SET DEFINE OFF

PROMPT ===== PART A1: statement-level atomicity =====
-- A multi-row INSERT in which ONE row breaks a constraint inserts NOTHING.
DECLARE
    v_before NUMBER;
    v_after  NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_before FROM departments;
    BEGIN
        INSERT INTO departments (dept_code, dept_name)
        SELECT 'TMP' || LEVEL, CASE LEVEL WHEN 3 THEN 'School of Computer Science and Engineering'  -- duplicate name
                                          ELSE 'Temporary dept ' || LEVEL END
          FROM dual CONNECT BY LEVEL <= 5;
    EXCEPTION
        WHEN DUP_VAL_ON_INDEX THEN
            DBMS_OUTPUT.PUT_LINE('A1 expected error: ' || SQLERRM);
    END;
    SELECT COUNT(*) INTO v_after FROM departments;
    DBMS_OUTPUT.PUT_LINE('A1 departments before=' || v_before || ' after=' || v_after
                         || CASE WHEN v_before = v_after THEN '  -> PASS (no partial insert)' ELSE '  -> FAIL' END);
END;
/

PROMPT ===== PART A2: savepoints =====
DECLARE
    v_student NUMBER;
    v_class   NUMBER;
    v_id      NUMBER;
    v_status  VARCHAR2(12);
    v_dup     NUMBER;
    v_day     TIMESTAMP := CAST(TRUNC(SYSDATE) + 22 AS TIMESTAMP);
BEGIN
    SELECT user_id INTO v_student FROM users WHERE email = 'rohan.g@campusreserve.example';
    SELECT resource_id INTO v_class FROM resources WHERE resource_code = 'SJT-CR-305';

    sp_create_booking(v_class, v_student, 'Savepoint demo', NULL, 10,
                      v_day + INTERVAL '10' HOUR, v_day + INTERVAL '11' HOUR, NULL, v_id, v_status, v_dup);
    DBMS_OUTPUT.PUT_LINE('A2 created booking ' || v_id || ' status=' || v_status);

    SAVEPOINT before_cancel;
    sp_cancel_booking(v_id, v_student, 'testing savepoint');
    SELECT status INTO v_status FROM bookings WHERE booking_id = v_id;
    DBMS_OUTPUT.PUT_LINE('A2 after cancel status=' || v_status);

    ROLLBACK TO SAVEPOINT before_cancel;
    SELECT status INTO v_status FROM bookings WHERE booking_id = v_id;
    DBMS_OUTPUT.PUT_LINE('A2 after ROLLBACK TO SAVEPOINT status=' || v_status
                         || CASE WHEN v_status = 'APPROVED' THEN '  -> PASS' ELSE '  -> FAIL' END);
    ROLLBACK;
END;
/

PROMPT ===== PART A3: multi-step unit of work rolled back on failure =====
-- Mirrors what the API does: several procedure calls in ONE transaction; any
-- failure rolls back all of them, so no half-finished work is ever committed.
DECLARE
    v_faculty NUMBER;
    v_hall    NUMBER;
    v_req     NUMBER;
    v_id      NUMBER;
    v_status  VARCHAR2(12);
    v_dup     NUMBER;
    v_res_status_before VARCHAR2(12);
    v_res_status_after  VARCHAR2(12);
    v_tickets_before    NUMBER;
    v_tickets_after     NUMBER;
BEGIN
    SELECT user_id INTO v_faculty FROM users WHERE email = 'kiran.menon@campusreserve.example';
    SELECT resource_id, status INTO v_hall, v_res_status_before FROM resources WHERE resource_code = 'TT-SH-701';
    SELECT COUNT(*) INTO v_tickets_before FROM maintenance_requests;

    SAVEPOINT unit_of_work;
    BEGIN
        -- Step 1 succeeds: ticket + resource -> MAINTENANCE
        sp_submit_maintenance(v_hall, v_faculty, 'Projector replacement', NULL, 'MEDIUM', 'Y', v_req);
        -- Step 2 fails: the hall is now under maintenance (-20003)
        sp_create_booking(v_hall, v_faculty, 'Workshop', NULL, 20,
                          CAST(TRUNC(SYSDATE) + 23 AS TIMESTAMP) + INTERVAL '10' HOUR,
                          CAST(TRUNC(SYSDATE) + 23 AS TIMESTAMP) + INTERVAL '12' HOUR,
                          NULL, v_id, v_status, v_dup);
    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('A3 step failed: ' || SQLERRM);
            ROLLBACK TO SAVEPOINT unit_of_work;
    END;

    SELECT status INTO v_res_status_after FROM resources WHERE resource_id = v_hall;
    SELECT COUNT(*) INTO v_tickets_after FROM maintenance_requests;
    DBMS_OUTPUT.PUT_LINE('A3 resource status ' || v_res_status_before || ' -> ' || v_res_status_after
                         || ', tickets ' || v_tickets_before || ' -> ' || v_tickets_after
                         || CASE WHEN v_res_status_after = v_res_status_before
                                  AND v_tickets_after = v_tickets_before
                                 THEN '  -> PASS (whole unit rolled back)' ELSE '  -> FAIL' END);
    ROLLBACK;
END;
/

/*==============================================================================
 PART B - TWO-SESSION CONCURRENCY PROTOCOL (TC-07, Experiment E2)
 Use two separate connections as the CAMPUS schema owner. Record the exact
 messages and timestamps you see; screenshot both windows side by side.

 ---------------------------------------------------------------------------
 B1. LOCKED PATH (the real implementation)
 ---------------------------------------------------------------------------
 Both sessions, first:
     SET SERVEROUTPUT ON
     VARIABLE id NUMBER
     VARIABLE st VARCHAR2(12)
     VARIABLE dup NUMBER

 Replace &res_id, &user_a and &user_b with the numbers printed by the helper
 query at the end of this file (or let SQL*Plus prompt for them).

 Session A:
     EXEC sp_create_booking(&res_id, &user_a, 'Session A', NULL, 10, CAST(TRUNC(SYSDATE)+30 AS TIMESTAMP)+INTERVAL '10' HOUR, CAST(TRUNC(SYSDATE)+30 AS TIMESTAMP)+INTERVAL '12' HOUR, NULL, :id, :st, :dup);
     PRINT id st
   -- DO NOT COMMIT YET. Session A now holds the row lock on the resource.

 Session B (within 5 seconds):
     EXEC sp_create_booking(&res_id, &user_b, 'Session B', NULL, 10, CAST(TRUNC(SYSDATE)+30 AS TIMESTAMP)+INTERVAL '11' HOUR, CAST(TRUNC(SYSDATE)+30 AS TIMESTAMP)+INTERVAL '13' HOUR, NULL, :id, :st, :dup);
   -- Observe: Session B BLOCKS (no prompt).

 Session A:
     COMMIT;

 Session B now continues and fails with
     ORA-20005: Time slot conflicts with booking #<A's id>.
   If you wait longer than 5 s before committing A, B instead gets
     ORA-20018: Resource is busy with another booking; please retry.
   Either way exactly ONE booking exists. Verify:
     SELECT booking_id, title, status FROM bookings
      WHERE resource_id = &res_id AND title LIKE 'Session %';

 ---------------------------------------------------------------------------
 B2. NAIVE PATH (to show WHY the lock is needed)
 ---------------------------------------------------------------------------
 The block below performs "check, then insert" WITHOUT locking the resource
 row and sleeps 5 s between check and insert to widen the race window.
 Run it in Session A, and within 5 s run it in Session B (change the title).
 Then COMMIT in both sessions.

     DECLARE
         v_cnt NUMBER;
         v_s TIMESTAMP := CAST(TRUNC(SYSDATE)+31 AS TIMESTAMP) + INTERVAL '10' HOUR;
         v_e TIMESTAMP := CAST(TRUNC(SYSDATE)+31 AS TIMESTAMP) + INTERVAL '12' HOUR;
     BEGIN
         SELECT COUNT(*) INTO v_cnt FROM bookings
          WHERE resource_id = &res_id AND status IN ('PENDING','APPROVED')
            AND start_time < v_e AND end_time > v_s;
         DBMS_OUTPUT.PUT_LINE('conflicts seen: ' || v_cnt);
         DBMS_SESSION.SLEEP(5);
         IF v_cnt = 0 THEN
             INSERT INTO bookings (resource_id, requested_by, title, attendees, start_time, end_time, status)
             VALUES (&res_id, &user_a, 'Naive A', 5, v_s, v_e, 'APPROVED');
             DBMS_OUTPUT.PUT_LINE('inserted');
         END IF;
     END;
     /
     COMMIT;

 Expected observation: BOTH sessions print "conflicts seen: 0" and "inserted",
 and BOTH commit. TRG_BOOKINGS_NO_OVERLAP does not fire an error because each
 session's AFTER STATEMENT check cannot see the other session's uncommitted
 row (read consistency). Verify the anomaly:
     SELECT a.booking_id, b.booking_id
       FROM bookings a JOIN bookings b
         ON a.resource_id = b.resource_id AND a.booking_id < b.booking_id
        AND a.status IN ('PENDING','APPROVED') AND b.status IN ('PENDING','APPROVED')
        AND a.start_time < b.end_time AND a.end_time > b.start_time;
 Clean up afterwards:
     UPDATE bookings SET status = 'CANCELLED', cancel_reason = 'experiment cleanup'
      WHERE title LIKE 'Naive %';
     COMMIT;
==============================================================================*/

-- Helper query: values to substitute for &res_id, &user_a, &user_b in Part B
SELECT 'res_id' AS variable, TO_CHAR(resource_id) AS value FROM resources WHERE resource_code = 'SJT-CR-305'
UNION ALL
SELECT 'user_a', TO_CHAR(user_id) FROM users WHERE email = 'rohan.g@campusreserve.example'
UNION ALL
SELECT 'user_b', TO_CHAR(user_id) FROM users WHERE email = 'sneha.k@campusreserve.example';

ROLLBACK;
