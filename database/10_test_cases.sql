--------------------------------------------------------------------------------
-- CampusReserve | 10_test_cases.sql
-- PURPOSE : Self-checking functional test suite for the database layer.
--           Every test prints  PASS / FAIL  with the observed result, and the
--           whole run is rolled back at the end, so it can be repeated.
-- RUN     : SQL*Plus / SQLcl / SQL Developer (F5 "Run Script"):
--             SET SERVEROUTPUT ON SIZE UNLIMITED
--             @10_test_cases.sql
-- EVIDENCE: Screenshot the DBMS_OUTPUT panel (see EVIDENCE_CAPTURE_GUIDE.md).
-- Test IDs match documentation/TESTING_GUIDE.md. API-only tests (TC-01..TC-03)
-- are in backend/tests; concurrency (TC-07) is in 12_transaction_tests.sql;
-- execution plans (TC-20) are in 11_query_optimization.sql.
--------------------------------------------------------------------------------
SET SERVEROUTPUT ON SIZE UNLIMITED
SET DEFINE OFF
SET FEEDBACK OFF

DECLARE
    g_pass PLS_INTEGER := 0;
    g_fail PLS_INTEGER := 0;

    v_student   NUMBER;   -- rohan.g  (SCOPE student)
    v_student2  NUMBER;   -- sneha.k  (SCOPE student)
    v_faculty   NUMBER;   -- kiran.menon (SCOPE faculty)
    v_coord     NUMBER;   -- coord.scope (SCOPE coordinator)
    v_coord_es  NUMBER;   -- coord.estate (ESTATE coordinator)
    v_admin     NUMBER;
    v_lab       NUMBER;   -- SJT-LAB-516  (COMP_LAB, approval, cap 60, SCOPE)
    v_class     NUMBER;   -- SJT-CR-302   (CLASSROOM, auto-approve)
    v_hall      NUMBER;   -- SJT-SH-801   (SEMINAR_HALL, ESTATE)
    v_closed    NUMBER;   -- SMV-LAB-220  (status MAINTENANCE)
    v_day       TIMESTAMP := CAST(TRUNC(SYSDATE) + 21 AS TIMESTAMP);   -- beyond seeded data

    v_id        NUMBER;
    v_id2       NUMBER;
    v_status    VARCHAR2(12);
    v_dup       NUMBER;
    v_num       NUMBER;
    v_txt       VARCHAR2(400);

    PROCEDURE ok (p_tc VARCHAR2, p_cond BOOLEAN, p_msg VARCHAR2) IS
    BEGIN
        IF p_cond THEN
            g_pass := g_pass + 1;
            DBMS_OUTPUT.PUT_LINE(RPAD(p_tc, 8) || 'PASS  ' || p_msg);
        ELSE
            g_fail := g_fail + 1;
            DBMS_OUTPUT.PUT_LINE(RPAD(p_tc, 8) || 'FAIL  ' || p_msg);
        END IF;
    END;

    -- Expected-error helper: record PASS if SQLCODE matches.
    PROCEDURE expect (p_tc VARCHAR2, p_expected NUMBER, p_actual NUMBER, p_err VARCHAR2) IS
    BEGIN
        ok(p_tc, p_actual = p_expected,
           'expected ORA' || p_expected || ', got ' || CASE WHEN p_actual = 0 THEN 'success'
                                                           ELSE SUBSTR(p_err, 1, 160) END);
    END;

    FUNCTION uid_of (p_email VARCHAR2) RETURN NUMBER IS
        v NUMBER;
    BEGIN
        SELECT user_id INTO v FROM users WHERE email = p_email;
        RETURN v;
    END;
    FUNCTION rid_of (p_code VARCHAR2) RETURN NUMBER IS
        v NUMBER;
    BEGIN
        SELECT resource_id INTO v FROM resources WHERE resource_code = p_code;
        RETURN v;
    END;
    FUNCTION at_hour (p_h NUMBER) RETURN TIMESTAMP IS
    BEGIN
        RETURN v_day + NUMTODSINTERVAL(p_h, 'HOUR');
    END;
BEGIN
    v_student  := uid_of('rohan.g@campusreserve.example');
    v_student2 := uid_of('sneha.k@campusreserve.example');
    v_faculty  := uid_of('kiran.menon@campusreserve.example');
    v_coord    := uid_of('coord.scope@campusreserve.example');
    v_coord_es := uid_of('coord.estate@campusreserve.example');
    v_admin    := uid_of('admin@campusreserve.example');
    v_lab      := rid_of('SJT-LAB-516');
    v_class    := rid_of('SJT-CR-302');
    v_hall     := rid_of('SJT-SH-801');
    v_closed   := rid_of('SMV-LAB-220');

    DBMS_OUTPUT.PUT_LINE('CampusReserve database test run @ ' || TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'));
    DBMS_OUTPUT.PUT_LINE('Test day used for bookings: ' || TO_CHAR(v_day, 'YYYY-MM-DD'));
    DBMS_OUTPUT.PUT_LINE(RPAD('-', 78, '-'));
    SAVEPOINT suite_start;

    -- TC-04 Resource creation (INSERT with constraints satisfied) ----------------
    BEGIN
        -- (INSERT ... VALUES, because RETURNING INTO is not allowed with INSERT ... SELECT before 23ai)
        INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept,
                               capacity, opens_at_hour, closes_at_hour, features_json)
        VALUES ('TEST-RES-01', 'Test Room',
                (SELECT category_id FROM resource_categories WHERE category_code = 'CLASSROOM'),
                (SELECT building_id FROM buildings WHERE building_code = 'SJT'),
                (SELECT dept_id FROM departments WHERE dept_code = 'SCOPE'),
                25, 8, 20, '{"test":true}')
        RETURNING resource_id INTO v_id;
        SELECT status INTO v_status FROM resources WHERE resource_id = v_id;
        ok('TC-04', v_status = 'AVAILABLE', 'resource created id=' || v_id || ', default status=' || v_status);
    EXCEPTION WHEN OTHERS THEN ok('TC-04', FALSE, SQLERRM);
    END;

    -- TC-05 Successful booking (requires approval -> PENDING) ---------------------
    BEGIN
        sp_create_booking(v_lab, v_student, 'DBMS mini-project demo', 'TC-05', 30,
                          at_hour(10), at_hour(12), NULL, v_id, v_status, v_dup);
        ok('TC-05', v_id IS NOT NULL AND v_status = 'PENDING',
           'booking id=' || v_id || ' status=' || v_status
           || ' duration=' || fn_booking_duration_hours(v_id) || 'h');
    EXCEPTION WHEN OTHERS THEN ok('TC-05', FALSE, SQLERRM);
    END;

    -- TC-05b Auto-approval for a category without approval -----------------------
    BEGIN
        sp_create_booking(v_class, v_student, 'Study group', NULL, 20,
                          at_hour(9), at_hour(10), NULL, v_id2, v_status, v_dup);
        ok('TC-05b', v_status = 'APPROVED', 'classroom booking auto-approved, id=' || v_id2);
    EXCEPTION WHEN OTHERS THEN ok('TC-05b', FALSE, SQLERRM);
    END;

    -- TC-06 Overlapping booking rejected (partial overlap 11:00-13:00 vs 10:00-12:00)
    BEGIN
        sp_create_booking(v_lab, v_student2, 'Overlap attempt', NULL, 10,
                          at_hour(11), at_hour(13), NULL, v_num, v_status, v_dup);
        expect('TC-06', -20005, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-06', -20005, SQLCODE, SQLERRM);
    END;

    -- TC-06b Back-to-back booking is allowed (12:00-14:00 touches but does not overlap)
    BEGIN
        sp_create_booking(v_lab, v_student2, 'Adjacent slot', NULL, 10,
                          at_hour(12), at_hour(14), NULL, v_num, v_status, v_dup);
        ok('TC-06b', v_num IS NOT NULL, 'adjacent booking accepted, id=' || v_num || ' (half-open intervals)');
    EXCEPTION WHEN OTHERS THEN ok('TC-06b', FALSE, SQLERRM);
    END;

    -- TC-08 Booking approval by the coordinator of the managing department ------
    BEGIN
        sp_decide_booking(v_id, v_coord, 'APPROVED', 'Approved for project demo');
        SELECT status INTO v_status FROM bookings WHERE booking_id = v_id;
        SELECT COUNT(*) INTO v_num FROM booking_approvals WHERE booking_id = v_id AND decision = 'APPROVED';
        ok('TC-08', v_status = 'APPROVED' AND v_num = 1, 'status=' || v_status || ', approval rows=' || v_num);
    EXCEPTION WHEN OTHERS THEN ok('TC-08', FALSE, SQLERRM);
    END;

    -- TC-08b Re-deciding an already approved booking is an invalid transition ---
    BEGIN
        sp_decide_booking(v_id, v_coord, 'REJECTED', 'second decision');
        expect('TC-08b', -20011, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-08b', -20011, SQLCODE, SQLERRM);
    END;

    -- TC-09 Booking rejection (needs a reason) -----------------------------------
    BEGIN
        sp_create_booking(v_lab, v_student2, 'Evening practice', NULL, 15,
                          at_hour(16), at_hour(18), NULL, v_id2, v_status, v_dup);
        sp_decide_booking(v_id2, v_coord, 'REJECTED', 'Lab reserved for maintenance window');
        SELECT status INTO v_status FROM bookings WHERE booking_id = v_id2;
        ok('TC-09', v_status = 'REJECTED', 'status=' || v_status);
    EXCEPTION WHEN OTHERS THEN ok('TC-09', FALSE, SQLERRM);
    END;

    -- TC-09b Rejected slot is free again -------------------------------------------
    BEGIN
        v_txt := fn_resource_availability(v_lab, at_hour(16), at_hour(18));
        ok('TC-09b', v_txt = 'AVAILABLE', 'availability after rejection = ' || v_txt);
    END;

    -- TC-10 Cancellation frees the slot -------------------------------------------
    BEGIN
        sp_cancel_booking(v_id, v_student, 'Demo moved online');
        SELECT status INTO v_status FROM bookings WHERE booking_id = v_id;
        v_txt := fn_resource_availability(v_lab, at_hour(10), at_hour(12));
        ok('TC-10', v_status = 'CANCELLED' AND v_txt = 'AVAILABLE',
           'status=' || v_status || ', slot now ' || v_txt);
    EXCEPTION WHEN OTHERS THEN ok('TC-10', FALSE, SQLERRM);
    END;

    -- TC-10b A student cannot cancel someone else's booking ------------------------
    BEGIN
        sp_create_booking(v_class, v_student2, 'Quiz prep', NULL, 10,
                          at_hour(14), at_hour(15), NULL, v_id2, v_status, v_dup);
        sp_cancel_booking(v_id2, v_student, 'not mine');
        expect('TC-10b', -20012, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-10b', -20012, SQLCODE, SQLERRM);
    END;

    -- TC-11 Booking a resource under maintenance -----------------------------------
    BEGIN
        sp_create_booking(v_closed, v_faculty, 'Physics lab', NULL, 10,
                          at_hour(10), at_hour(11), NULL, v_num, v_status, v_dup);
        expect('TC-11', -20003, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-11', -20003, SQLCODE, SQLERRM);
    END;

    -- TC-12 Unauthorised approval (student tries to approve) -----------------------
    BEGIN
        sp_create_booking(v_lab, v_faculty, 'Faculty meeting', NULL, 5,
                          at_hour(14), at_hour(16), NULL, v_id2, v_status, v_dup);
        sp_decide_booking(v_id2, v_student, 'APPROVED', 'self-approval attempt');
        expect('TC-12', -20012, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-12', -20012, SQLCODE, SQLERRM);
    END;

    -- TC-12b Coordinator of another department cannot approve ---------------------
    BEGIN
        sp_decide_booking(v_id2, v_coord_es, 'APPROVED', 'wrong department');
        expect('TC-12b', -20012, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-12b', -20012, SQLCODE, SQLERRM);
    END;

    -- TC-13 Maintenance ticket creation that blocks bookings --------------------------
    BEGIN
        sp_submit_maintenance(v_hall, v_faculty, 'Ceiling leak above stage', 'Water dripping on row A.',
                              'HIGH', 'Y', v_id);
        SELECT status INTO v_status FROM resources WHERE resource_id = v_hall;
        ok('TC-13', v_id IS NOT NULL AND v_status = 'MAINTENANCE',
           'request id=' || v_id || ', resource status=' || v_status);
    EXCEPTION WHEN OTHERS THEN ok('TC-13', FALSE, SQLERRM);
    END;

    -- TC-13b A student cannot take a resource out of service --------------------------
    BEGIN
        sp_submit_maintenance(v_lab, v_student, 'Mouse broken', NULL, 'LOW', 'Y', v_num);
        expect('TC-13b', -20012, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-13b', -20012, SQLCODE, SQLERRM);
    END;

    -- TC-14 Maintenance status update restores availability ---------------------------
    BEGIN
        sp_update_maintenance_status(v_id, v_coord_es, 'IN_PROGRESS', v_coord_es, NULL);
        sp_update_maintenance_status(v_id, v_coord_es, 'RESOLVED', NULL, 'Roof sealed.');
        SELECT m.status || '/' || r.status || '/' || NVL2(m.resolved_at, 'resolved_at set', 'resolved_at null')
          INTO v_txt
          FROM maintenance_requests m JOIN resources r ON r.resource_id = m.resource_id
         WHERE m.request_id = v_id;
        ok('TC-14', v_txt = 'RESOLVED/AVAILABLE/resolved_at set', 'ticket/resource/timestamp = ' || v_txt);
    EXCEPTION WHEN OTHERS THEN ok('TC-14', FALSE, SQLERRM);
    END;

    -- TC-14b Illegal ticket transition CLOSED -> OPEN --------------------------------
    BEGIN
        sp_update_maintenance_status(v_id, v_coord_es, 'CLOSED', NULL, NULL);
        sp_update_maintenance_status(v_id, v_coord_es, 'OPEN', NULL, NULL);
        expect('TC-14b', -20011, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-14b', -20011, SQLCODE, SQLERRM);
    END;

    -- TC-15 Audit log generation ---------------------------------------------------------
    BEGIN
        SELECT COUNT(*) INTO v_num FROM audit_logs
         WHERE table_name = 'MAINTENANCE_REQUESTS' AND record_id = v_id;
        SELECT COUNT(*) INTO v_dup FROM audit_logs
         WHERE table_name = 'RESOURCES' AND record_id = v_hall
           AND changed_at > SYSTIMESTAMP - INTERVAL '5' MINUTE;
        ok('TC-15', v_num >= 4 AND v_dup >= 2,
           v_num || ' audit rows for ticket ' || v_id || ', ' || v_dup || ' resource status changes');
    EXCEPTION WHEN OTHERS THEN ok('TC-15', FALSE, SQLERRM);
    END;

    -- TC-15b Audit log is append-only -----------------------------------------------------
    BEGIN
        DELETE FROM audit_logs WHERE ROWNUM = 1;
        expect('TC-15b', -20012, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-15b', -20012, SQLCODE, SQLERRM);
    END;

    -- TC-16 Utilisation function equals an independent SQL calculation -----------------
    DECLARE
        v_fn     NUMBER;
        v_manual NUMBER;
    BEGIN
        v_fn := fn_resource_utilisation(v_lab, TRUNC(SYSDATE) - 30, TRUNC(SYSDATE));
        SELECT ROUND(100 * NVL(SUM((CAST(end_time AS DATE) - CAST(start_time AS DATE)) * 24), 0)
                     / (30 * (r.closes_at_hour - r.opens_at_hour)), 2)
          INTO v_manual
          FROM resources r
          LEFT JOIN bookings b ON b.resource_id = r.resource_id AND b.status = 'APPROVED'
                              AND b.start_time >= CAST(TRUNC(SYSDATE) - 30 AS TIMESTAMP)
                              AND b.end_time   <= CAST(TRUNC(SYSDATE) AS TIMESTAMP)
         WHERE r.resource_id = v_lab
         GROUP BY r.closes_at_hour, r.opens_at_hour;
        ok('TC-16', v_fn = v_manual, 'function=' || v_fn || '%  manual SQL=' || v_manual || '%');
    EXCEPTION WHEN OTHERS THEN ok('TC-16', FALSE, SQLERRM);
    END;

    -- TC-17 Invalid foreign key ---------------------------------------------------------
    BEGIN
        INSERT INTO bookings (resource_id, requested_by, title, start_time, end_time)
        VALUES (v_lab, -999, 'FK test', at_hour(8), at_hour(9));
        expect('TC-17', -2291, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-17', -2291, SQLCODE, SQLERRM);
    END;

    -- TC-18 CHECK constraint violation (end before start, bypassing the procedure) ------
    BEGIN
        INSERT INTO bookings (resource_id, requested_by, title, start_time, end_time)
        VALUES (v_class, v_student, 'Check test', at_hour(18), at_hour(17));
        expect('TC-18', -2290, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-18', -2290, SQLCODE, SQLERRM);
    END;

    -- TC-18b UNIQUE constraint (duplicate e-mail, different case) ------------------------
    BEGIN
        INSERT INTO users (role_id, dept_id, full_name, email, password_hash)
        SELECT 1, dept_id, 'Duplicate', 'ROHAN.G@CampusReserve.example', 'x' FROM users WHERE user_id = v_student;
        expect('TC-18b', -1, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-18b', -1, SQLCODE, SQLERRM);
    END;

    -- TC-18c Invalid interval through the procedure --------------------------------------
    BEGIN
        sp_create_booking(v_class, v_student, 'Backwards', NULL, 5,
                          at_hour(15), at_hour(14), NULL, v_num, v_status, v_dup);
        expect('TC-18c', -20001, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-18c', -20001, SQLCODE, SQLERRM);
    END;

    -- TC-18d Capacity exceeded ----------------------------------------------------------
    BEGIN
        sp_create_booking(v_class, v_student, 'Too many people', NULL, 500,
                          at_hour(17), at_hour(18), NULL, v_num, v_status, v_dup);
        expect('TC-18d', -20006, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-18d', -20006, SQLCODE, SQLERRM);
    END;

    -- TC-18e Outside operating hours -----------------------------------------------------
    BEGIN
        sp_create_booking(v_class, v_student, 'Late night', NULL, 5,
                          at_hour(19), at_hour(21), NULL, v_num, v_status, v_dup);
        expect('TC-18e', -20008, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-18e', -20008, SQLCODE, SQLERRM);
    END;

    -- TC-18f Blackout period (seeded EXAM blackout next ISO-week Sunday) ----------------
    BEGIN
        sp_create_booking(v_class, v_faculty, 'During exam', NULL, 5,
                          CAST(TRUNC(SYSDATE, 'IW') + 13 AS TIMESTAMP) + INTERVAL '10' HOUR,
                          CAST(TRUNC(SYSDATE, 'IW') + 13 AS TIMESTAMP) + INTERVAL '11' HOUR,
                          NULL, v_num, v_status, v_dup);
        expect('TC-18f', -20007, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-18f', -20007, SQLCODE, SQLERRM);
    END;

    -- TC-18g Idempotent retry returns the original booking ------------------------------
    BEGIN
        sp_create_booking(v_class, v_student, 'Idempotent', NULL, 5,
                          at_hour(11), at_hour(12), 'tc18g-key', v_id, v_status, v_dup);
        sp_create_booking(v_class, v_student, 'Idempotent', NULL, 5,
                          at_hour(11), at_hour(12), 'tc18g-key', v_id2, v_status, v_dup);
        ok('TC-18g', v_id = v_id2 AND v_dup = 1, 'first id=' || v_id || ', retry id=' || v_id2 || ', duplicate flag=' || v_dup);
    EXCEPTION WHEN OTHERS THEN ok('TC-18g', FALSE, SQLERRM);
    END;

    -- TC-18h Trigger catches an overlap inserted WITHOUT the procedure -------------------
    BEGIN
        INSERT INTO bookings (resource_id, requested_by, title, attendees, start_time, end_time, status)
        VALUES (v_class, v_student2, 'Raw insert overlap', 5, at_hour(11), at_hour(12), 'APPROVED');
        expect('TC-18h', -20017, 0, NULL);
    EXCEPTION WHEN OTHERS THEN expect('TC-18h', -20017, SQLCODE, SQLERRM);
    END;

    -- TC-19 Transaction rollback restores the previous state ---------------------------
    DECLARE
        v_before NUMBER;
        v_after  NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_before FROM bookings;
        SAVEPOINT tc19;
        sp_create_booking(v_class, v_student, 'Will be rolled back', NULL, 5,
                          at_hour(13), at_hour(14), NULL, v_num, v_status, v_dup);
        ROLLBACK TO SAVEPOINT tc19;
        SELECT COUNT(*) INTO v_after FROM bookings;
        ok('TC-19', v_before = v_after AND fn_resource_availability(v_class, at_hour(13), at_hour(14)) = 'AVAILABLE',
           'rows before=' || v_before || ', after rollback=' || v_after);
    EXCEPTION WHEN OTHERS THEN ok('TC-19', FALSE, SQLERRM);
    END;

    -- TC-21 Cursors in packages ------------------------------------------------------------
    BEGIN
        pkg_campus_reservations.send_pending_digest(v_admin, v_num);
        ok('TC-21a', v_num >= 0, 'explicit-cursor digest counted ' || v_num || ' pending bookings');

        pkg_resource_analytics.build_utilisation_snapshot(TRUNC(SYSDATE) - 30, TRUNC(SYSDATE), v_num);
        SELECT COUNT(*) INTO v_dup FROM utilisation_snapshots
         WHERE period_start = TRUNC(SYSDATE) - 30 AND period_end = TRUNC(SYSDATE);
        ok('TC-21b', v_num = v_dup AND v_num > 0, 'snapshot cursor wrote ' || v_num || ' rows');

        pkg_resource_analytics.escalate_stale_maintenance(7, v_num);
        ok('TC-21c', v_num >= 1, 'cursor FOR loop escalated ' || v_num || ' stale ticket(s)');

        pkg_campus_reservations.expire_stale_pending(v_admin, v_num);
        ok('TC-21d', v_num >= 0, 'expiry cursor closed ' || v_num || ' stale pending booking(s)');
    EXCEPTION WHEN OTHERS THEN ok('TC-21', FALSE, SQLERRM);
    END;

    -- TC-22 Pipelined slot generator ------------------------------------------------------
    BEGIN
        SELECT COUNT(*) INTO v_num
          FROM TABLE(pkg_campus_reservations.day_slots(v_class, CAST(v_day AS DATE), 60));
        ok('TC-22', v_num = 12, 'day_slots returned ' || v_num || ' one-hour slots for 08:00-20:00');
    EXCEPTION WHEN OTHERS THEN ok('TC-22', FALSE, SQLERRM);
    END;

    ROLLBACK TO SAVEPOINT suite_start;
    DBMS_OUTPUT.PUT_LINE(RPAD('-', 78, '-'));
    DBMS_OUTPUT.PUT_LINE('TOTAL: ' || (g_pass + g_fail) || '   PASS: ' || g_pass || '   FAIL: ' || g_fail);
    DBMS_OUTPUT.PUT_LINE('All test changes rolled back.');
END;
/
ROLLBACK;
SET FEEDBACK ON
