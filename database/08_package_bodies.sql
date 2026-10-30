--------------------------------------------------------------------------------
-- CampusReserve | 08_package_bodies.sql
-- PURPOSE : Implementations of PKG_CAMPUS_RESERVATIONS and PKG_RESOURCE_ANALYTICS.
-- Cursor techniques demonstrated:
--   * explicit cursor with OPEN / FETCH / %NOTFOUND / %ROWCOUNT / CLOSE
--       -> pkg_campus_reservations.send_pending_digest
--   * explicit cursor FOR UPDATE SKIP LOCKED + WHERE CURRENT OF
--       -> pkg_campus_reservations.expire_stale_pending
--   * cursor FOR loop over maintenance requests (FOR UPDATE / WHERE CURRENT OF)
--       -> pkg_resource_analytics.escalate_stale_maintenance
--   * parameterised cursor FOR loop feeding a MERGE (reporting)
--       -> pkg_resource_analytics.build_utilisation_snapshot
--   * REF CURSORs (SYS_REFCURSOR) returned to the Node.js API
--------------------------------------------------------------------------------
SET DEFINE OFF

CREATE OR REPLACE PACKAGE BODY pkg_campus_reservations AS

    -- Private helper: returns 'Y' when the user may approve, and the approver's
    -- department / admin flag through OUT parameters.
    PROCEDURE load_approver (
        p_user_id  IN  NUMBER,
        o_dept_id  OUT NUMBER,
        o_is_admin OUT CHAR
    ) IS
    BEGIN
        SELECT u.dept_id, CASE ro.role_code WHEN 'ADMIN' THEN 'Y' ELSE 'N' END
          INTO o_dept_id, o_is_admin
          FROM users u JOIN roles ro ON ro.role_id = u.role_id
         WHERE u.user_id = p_user_id AND u.is_active = 'Y' AND ro.can_approve = 'Y';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20012, 'User ' || p_user_id || ' is not an approver.');
    END load_approver;

    FUNCTION day_slots (
        p_resource_id  IN NUMBER,
        p_day          IN DATE,
        p_slot_minutes IN NUMBER DEFAULT 60
    ) RETURN t_slot_tab PIPELINED
    IS
        v_row     t_slot;
        v_status  resources.status%TYPE;
        v_open    resources.opens_at_hour%TYPE;
        v_close   resources.closes_at_hour%TYPE;
        v_day     TIMESTAMP := CAST(TRUNC(p_day) AS TIMESTAMP);
        v_cursor  TIMESTAMP;
        v_last    TIMESTAMP;
        v_step    INTERVAL DAY TO SECOND;
        v_count   PLS_INTEGER;
    BEGIN
        IF p_slot_minutes IS NULL OR p_slot_minutes NOT BETWEEN 15 AND 240 THEN
            RAISE_APPLICATION_ERROR(-20016, 'Slot length must be 15-240 minutes.');
        END IF;
        BEGIN
            SELECT status, opens_at_hour, closes_at_hour
              INTO v_status, v_open, v_close
              FROM resources WHERE resource_id = p_resource_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN RETURN;      -- unknown resource: empty result
        END;

        v_step   := NUMTODSINTERVAL(p_slot_minutes, 'MINUTE');
        v_cursor := v_day + NUMTODSINTERVAL(v_open, 'HOUR');
        v_last   := v_day + NUMTODSINTERVAL(v_close, 'HOUR');

        WHILE v_cursor + v_step <= v_last LOOP
            v_row.slot_start := v_cursor;
            v_row.slot_end   := v_cursor + v_step;
            v_row.booking_id := NULL;

            IF v_status <> 'AVAILABLE' THEN
                v_row.slot_state := 'CLOSED';
            ELSIF v_row.slot_end <= SYSTIMESTAMP THEN
                v_row.slot_state := 'PAST';
            ELSE
                SELECT COUNT(*) INTO v_count
                  FROM resource_blackouts
                 WHERE resource_id = p_resource_id
                   AND start_time < v_row.slot_end AND end_time > v_row.slot_start;
                IF v_count > 0 THEN
                    v_row.slot_state := 'BLACKOUT';
                ELSE
                    -- Prefer an APPROVED booking over a PENDING one if both touch the slot.
                    SELECT MAX(status) KEEP (DENSE_RANK FIRST ORDER BY CASE status WHEN 'APPROVED' THEN 0 ELSE 1 END),
                           MAX(booking_id) KEEP (DENSE_RANK FIRST ORDER BY CASE status WHEN 'APPROVED' THEN 0 ELSE 1 END)
                      INTO v_row.slot_state, v_row.booking_id
                      FROM bookings
                     WHERE resource_id = p_resource_id
                       AND status IN ('PENDING', 'APPROVED')
                       AND start_time < v_row.slot_end AND end_time > v_row.slot_start;
                    v_row.slot_state := CASE v_row.slot_state
                                            WHEN 'APPROVED' THEN 'BOOKED'
                                            WHEN 'PENDING'  THEN 'PENDING'
                                            ELSE 'FREE' END;
                END IF;
            END IF;

            PIPE ROW (v_row);
            v_cursor := v_cursor + v_step;
        END LOOP;
        RETURN;
    END day_slots;

    FUNCTION resource_schedule (
        p_resource_id IN NUMBER,
        p_from        IN TIMESTAMP,
        p_to          IN TIMESTAMP
    ) RETURN SYS_REFCURSOR
    IS
        v_cur SYS_REFCURSOR;
    BEGIN
        IF p_to <= p_from THEN
            RAISE_APPLICATION_ERROR(-20001, 'Schedule window end must be after start.');
        END IF;
        OPEN v_cur FOR
            SELECT 'BOOKING' AS entry_kind, v.booking_id AS entry_id, v.title,
                   v.status AS entry_status, v.start_time, v.end_time,
                   v.requester_name, v.requester_id
              FROM v_booking_details v
             WHERE v.resource_id = p_resource_id
               AND v.status IN ('PENDING', 'APPROVED')
               AND v.start_time < p_to AND v.end_time > p_from
            UNION ALL
            SELECT 'BLACKOUT', bo.blackout_id, bo.reason, bo.blackout_type,
                   bo.start_time, bo.end_time, NULL, NULL
              FROM resource_blackouts bo
             WHERE bo.resource_id = p_resource_id
               AND bo.start_time < p_to AND bo.end_time > p_from
             ORDER BY 5;
        RETURN v_cur;
    END resource_schedule;

    FUNCTION pending_for_approver (p_approver_id IN NUMBER) RETURN SYS_REFCURSOR
    IS
        v_cur      SYS_REFCURSOR;
        v_dept     NUMBER;
        v_is_admin CHAR(1);
    BEGIN
        load_approver(p_approver_id, v_dept, v_is_admin);
        OPEN v_cur FOR
            SELECT p.*
              FROM v_pending_approvals p
              JOIN resources r ON r.resource_id = p.resource_id
             WHERE v_is_admin = 'Y' OR r.managed_by_dept = v_dept
             ORDER BY p.start_time;
        RETURN v_cur;
    END pending_for_approver;

    PROCEDURE send_pending_digest (
        p_approver_id   IN  NUMBER,
        o_pending_count OUT NUMBER
    ) IS
        v_dept     NUMBER;
        v_is_admin CHAR(1);
        v_message  VARCHAR2(500);

        -- Explicit, parameterised cursor over the approver's queue.
        CURSOR c_queue (cp_dept NUMBER, cp_is_admin CHAR) IS
            SELECT p.booking_id, p.resource_code, p.start_time, p.requester_name
              FROM v_pending_approvals p
              JOIN resources r ON r.resource_id = p.resource_id
             WHERE cp_is_admin = 'Y' OR r.managed_by_dept = cp_dept
             ORDER BY p.start_time;
        v_rec c_queue%ROWTYPE;
    BEGIN
        load_approver(p_approver_id, v_dept, v_is_admin);

        OPEN c_queue(v_dept, v_is_admin);
        LOOP
            FETCH c_queue INTO v_rec;
            EXIT WHEN c_queue%NOTFOUND;
            -- Keep the digest short; list the first five requests explicitly.
            IF c_queue%ROWCOUNT <= 5 THEN
                v_message := v_message
                          || CASE WHEN v_message IS NOT NULL THEN '; ' END
                          || '#' || v_rec.booking_id || ' ' || v_rec.resource_code
                          || ' ' || TO_CHAR(v_rec.start_time, 'DD-Mon HH24:MI');
            END IF;
        END LOOP;
        o_pending_count := c_queue%ROWCOUNT;
        CLOSE c_queue;

        IF o_pending_count > 0 THEN
            INSERT INTO notifications (user_id, notif_type, title, message)
            VALUES (p_approver_id, 'APPROVAL',
                    o_pending_count || ' booking(s) awaiting your decision',
                    SUBSTR(v_message || CASE WHEN o_pending_count > 5
                                             THEN ' ... and ' || (o_pending_count - 5) || ' more' END, 1, 500));
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            IF c_queue%ISOPEN THEN CLOSE c_queue; END IF;
            RAISE;
    END send_pending_digest;

    PROCEDURE expire_stale_pending (
        p_actor_id IN  NUMBER,
        o_expired  OUT NUMBER
    ) IS
        v_dept     NUMBER;
        v_is_admin CHAR(1);
        -- SKIP LOCKED: rows another session is deciding right now are left alone
        -- instead of blocking this batch job.
        CURSOR c_stale IS
            SELECT b.booking_id, b.requested_by, b.start_time
              FROM bookings b
             WHERE b.status = 'PENDING'
               AND b.start_time <= SYSTIMESTAMP
               FOR UPDATE OF b.status SKIP LOCKED;
        v_rec c_stale%ROWTYPE;
    BEGIN
        load_approver(p_actor_id, v_dept, v_is_admin);
        IF v_is_admin = 'N' THEN
            RAISE_APPLICATION_ERROR(-20012, 'Only administrators may run the expiry job.');
        END IF;

        o_expired := 0;
        OPEN c_stale;
        LOOP
            FETCH c_stale INTO v_rec;
            EXIT WHEN c_stale%NOTFOUND;

            UPDATE bookings SET status = c_rejected WHERE CURRENT OF c_stale;

            INSERT INTO booking_approvals (booking_id, approver_id, decision, remarks)
            VALUES (v_rec.booking_id, p_actor_id, c_rejected,
                    'Auto-rejected: no decision before the start time');

            INSERT INTO notifications (user_id, notif_type, title, message, booking_id)
            VALUES (v_rec.requested_by, 'APPROVAL', 'Booking expired',
                    'Request #' || v_rec.booking_id || ' for '
                    || TO_CHAR(v_rec.start_time, 'DD-Mon HH24:MI')
                    || ' was not decided in time and has been closed.', v_rec.booking_id);
            o_expired := o_expired + 1;
        END LOOP;
        CLOSE c_stale;
    EXCEPTION
        WHEN OTHERS THEN
            IF c_stale%ISOPEN THEN CLOSE c_stale; END IF;
            RAISE;
    END expire_stale_pending;

END pkg_campus_reservations;
/

CREATE OR REPLACE PACKAGE BODY pkg_resource_analytics AS

    FUNCTION utilisation (
        p_resource_id IN NUMBER,
        p_from        IN DATE,
        p_to          IN DATE
    ) RETURN NUMBER IS
    BEGIN
        RETURN fn_resource_utilisation(p_resource_id, p_from, p_to);
    END utilisation;

    FUNCTION dashboard_summary RETURN SYS_REFCURSOR
    IS
        v_cur SYS_REFCURSOR;
    BEGIN
        OPEN v_cur FOR
            SELECT
                (SELECT COUNT(*) FROM resources WHERE status <> 'RETIRED')        AS total_resources,
                (SELECT COUNT(*) FROM resources WHERE status = 'AVAILABLE')       AS available_resources,
                (SELECT COUNT(*) FROM resources WHERE status = 'MAINTENANCE')     AS resources_in_maintenance,
                (SELECT COUNT(*) FROM bookings
                  WHERE status = 'APPROVED'
                    AND SYSTIMESTAMP BETWEEN start_time AND end_time)            AS active_now,
                (SELECT COUNT(*) FROM bookings
                  WHERE status = 'APPROVED' AND start_time > SYSTIMESTAMP)       AS upcoming_approved,
                (SELECT COUNT(*) FROM bookings
                  WHERE status = 'PENDING' AND start_time > SYSTIMESTAMP)        AS pending_approvals,
                (SELECT COUNT(*) FROM maintenance_requests
                  WHERE status IN ('OPEN', 'IN_PROGRESS'))                        AS open_maintenance,
                (SELECT COUNT(*) FROM bookings
                  WHERE status IN ('PENDING', 'APPROVED')
                    AND start_time >= CAST(TRUNC(SYSDATE) AS TIMESTAMP)
                    AND start_time <  CAST(TRUNC(SYSDATE) + 1 AS TIMESTAMP))      AS bookings_today,
                (SELECT ROUND(AVG(utilisation_pct), 2)
                   FROM v_resource_utilisation_30d)                               AS avg_utilisation_30d
            FROM dual;
        RETURN v_cur;
    END dashboard_summary;

    FUNCTION booking_trend (p_days IN NUMBER DEFAULT 30) RETURN SYS_REFCURSOR
    IS
        v_cur  SYS_REFCURSOR;
        v_days PLS_INTEGER := LEAST(GREATEST(NVL(p_days, 30), 7), 60);
    BEGIN
        -- Row generator guarantees one row per day, including days with no bookings.
        OPEN v_cur FOR
            WITH days AS (
                SELECT TRUNC(SYSDATE) - v_days + LEVEL AS booking_day
                  FROM dual CONNECT BY LEVEL <= v_days + 7
            )
            SELECT d.booking_day,
                   NVL(t.total, 0)     AS total,
                   NVL(t.approved, 0)  AS approved,
                   NVL(t.pending, 0)   AS pending,
                   NVL(t.rejected, 0)  AS rejected,
                   NVL(t.cancelled, 0) AS cancelled
              FROM days d
              LEFT JOIN v_booking_trend_daily t ON t.booking_day = d.booking_day
             ORDER BY d.booking_day;
        RETURN v_cur;
    END booking_trend;

    FUNCTION top_resources (p_from IN DATE, p_to IN DATE, p_limit IN NUMBER DEFAULT 5)
        RETURN SYS_REFCURSOR
    IS
        v_cur   SYS_REFCURSOR;
        v_limit PLS_INTEGER := LEAST(GREATEST(NVL(p_limit, 5), 1), 50);
    BEGIN
        OPEN v_cur FOR
            SELECT r.resource_id, r.resource_code, r.resource_name, c.category_code,
                   COUNT(b.booking_id) AS approved_count,
                   ROUND(SUM(fn_hours_between(b.start_time, b.end_time)), 1) AS approved_hours
              FROM bookings b
              JOIN resources r           ON r.resource_id = b.resource_id
              JOIN resource_categories c ON c.category_id = r.category_id
             WHERE b.status = 'APPROVED'
               AND b.start_time >= CAST(p_from AS TIMESTAMP)
               AND b.start_time <  CAST(p_to   AS TIMESTAMP)
             GROUP BY r.resource_id, r.resource_code, r.resource_name, c.category_code
             ORDER BY approved_count DESC, approved_hours DESC
             FETCH FIRST v_limit ROWS ONLY;
        RETURN v_cur;
    END top_resources;

    FUNCTION department_usage (p_from IN DATE, p_to IN DATE) RETURN SYS_REFCURSOR
    IS
        v_cur SYS_REFCURSOR;
    BEGIN
        OPEN v_cur FOR
            SELECT d.dept_code, d.dept_name,
                   COUNT(*)                                               AS total_requests,
                   SUM(CASE WHEN b.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
                   ROUND(SUM(CASE WHEN b.status = 'APPROVED'
                                  THEN fn_hours_between(b.start_time, b.end_time)
                                  ELSE 0 END), 1)                         AS approved_hours,
                   COUNT(DISTINCT b.resource_id)                          AS distinct_resources
              FROM bookings b
              JOIN users u       ON u.user_id = b.requested_by
              JOIN departments d ON d.dept_id = u.dept_id
             WHERE b.start_time >= CAST(p_from AS TIMESTAMP)
               AND b.start_time <  CAST(p_to   AS TIMESTAMP)
             GROUP BY d.dept_code, d.dept_name
            HAVING COUNT(*) > 0
             ORDER BY approved_hours DESC;
        RETURN v_cur;
    END department_usage;

    FUNCTION resource_utilisation (p_from IN DATE, p_to IN DATE) RETURN SYS_REFCURSOR
    IS
        v_cur SYS_REFCURSOR;
    BEGIN
        OPEN v_cur FOR
            SELECT r.resource_id, r.resource_code, r.resource_name, c.category_code, r.status,
                   fn_resource_utilisation(r.resource_id, p_from, p_to) AS utilisation_pct
              FROM resources r
              JOIN resource_categories c ON c.category_id = r.category_id
             WHERE r.status <> 'RETIRED'
             ORDER BY utilisation_pct DESC, r.resource_code;
        RETURN v_cur;
    END resource_utilisation;

    FUNCTION peak_hours (p_from IN DATE, p_to IN DATE) RETURN SYS_REFCURSOR
    IS
        v_cur SYS_REFCURSOR;
    BEGIN
        OPEN v_cur FOR
            SELECT TRUNC(CAST(start_time AS DATE)) - TRUNC(CAST(start_time AS DATE), 'IW') + 1 AS iso_weekday,
                   EXTRACT(HOUR FROM start_time) AS start_hour,
                   COUNT(*) AS bookings
              FROM bookings
             WHERE status = 'APPROVED'
               AND start_time >= CAST(p_from AS TIMESTAMP)
               AND start_time <  CAST(p_to   AS TIMESTAMP)
             GROUP BY TRUNC(CAST(start_time AS DATE)) - TRUNC(CAST(start_time AS DATE), 'IW') + 1,
                      EXTRACT(HOUR FROM start_time)
             ORDER BY 1, 2;
        RETURN v_cur;
    END peak_hours;

    PROCEDURE build_utilisation_snapshot (
        p_from IN  DATE,
        p_to   IN  DATE,
        o_rows OUT NUMBER
    ) IS
        CURSOR c_res (cp_from TIMESTAMP, cp_to TIMESTAMP) IS
            SELECT r.resource_id, r.opens_at_hour, r.closes_at_hour,
                   COUNT(b.booking_id) AS booking_count,
                   NVL(SUM(fn_hours_between(GREATEST(b.start_time, cp_from),
                                            LEAST(b.end_time, cp_to))), 0) AS booked_hours
              FROM resources r
              LEFT JOIN bookings b
                     ON b.resource_id = r.resource_id
                    AND b.status = 'APPROVED'
                    AND b.start_time < cp_to
                    AND b.end_time   > cp_from
             WHERE r.status <> 'RETIRED'
             GROUP BY r.resource_id, r.opens_at_hour, r.closes_at_hour;
        v_available NUMBER;
        v_pct       NUMBER;
    BEGIN
        IF p_from IS NULL OR p_to IS NULL OR TRUNC(p_to) <= TRUNC(p_from) THEN
            RAISE_APPLICATION_ERROR(-20001, 'Snapshot window must have p_to after p_from.');
        END IF;
        o_rows := 0;
        FOR rec IN c_res(CAST(TRUNC(p_from) AS TIMESTAMP), CAST(TRUNC(p_to) AS TIMESTAMP)) LOOP
            v_available := (TRUNC(p_to) - TRUNC(p_from)) * (rec.closes_at_hour - rec.opens_at_hour);
            v_pct       := LEAST(100, ROUND(100 * rec.booked_hours / v_available, 2));

            MERGE INTO utilisation_snapshots s
            USING (SELECT rec.resource_id AS resource_id, TRUNC(p_from) AS ps, TRUNC(p_to) AS pe
                     FROM dual) src
               ON (s.resource_id = src.resource_id AND s.period_start = src.ps AND s.period_end = src.pe)
            WHEN MATCHED THEN UPDATE
                 SET s.booked_hours = ROUND(rec.booked_hours, 2), s.available_hours = v_available,
                     s.utilisation_pct = v_pct, s.booking_count = rec.booking_count,
                     s.generated_at = SYSTIMESTAMP
            WHEN NOT MATCHED THEN INSERT
                 (resource_id, period_start, period_end, booked_hours, available_hours,
                  utilisation_pct, booking_count)
                 VALUES (src.resource_id, src.ps, src.pe, ROUND(rec.booked_hours, 2), v_available,
                         v_pct, rec.booking_count);
            o_rows := o_rows + 1;
        END LOOP;
    END build_utilisation_snapshot;

    PROCEDURE escalate_stale_maintenance (
        p_days      IN  NUMBER DEFAULT 7,
        o_escalated OUT NUMBER
    ) IS
        CURSOR c_stale IS
            SELECT m.request_id, m.priority, m.title, r.resource_name
              FROM maintenance_requests m
              JOIN resources r ON r.resource_id = m.resource_id
             WHERE m.status = 'OPEN'
               AND m.priority <> 'CRITICAL'
               AND m.created_at < SYSTIMESTAMP - NUMTODSINTERVAL(NVL(p_days, 7), 'DAY')
               FOR UPDATE OF m.priority;
        v_new_priority maintenance_requests.priority%TYPE;
    BEGIN
        o_escalated := 0;
        FOR rec IN c_stale LOOP
            v_new_priority := CASE rec.priority WHEN 'LOW'    THEN 'MEDIUM'
                                                WHEN 'MEDIUM' THEN 'HIGH'
                                                ELSE 'CRITICAL' END;
            UPDATE maintenance_requests
               SET priority = v_new_priority
             WHERE CURRENT OF c_stale;

            INSERT INTO notifications (user_id, notif_type, title, message)
            SELECT u.user_id, 'MAINTENANCE', 'Maintenance escalated',
                   'Request #' || rec.request_id || ' (' || rec.resource_name || ': '
                   || SUBSTR(rec.title, 1, 80) || ') raised from ' || rec.priority
                   || ' to ' || v_new_priority || ' after ' || NVL(p_days, 7) || ' days open.'
              FROM users u JOIN roles ro ON ro.role_id = u.role_id
             WHERE ro.role_code = 'ADMIN' AND u.is_active = 'Y';
            o_escalated := o_escalated + 1;
        END LOOP;
    END escalate_stale_maintenance;

    PROCEDURE print_utilisation_report (p_from IN DATE, p_to IN DATE)
    IS
        v_total_pct NUMBER := 0;
        v_n         PLS_INTEGER := 0;
        v_pct       NUMBER;
    BEGIN
        DBMS_OUTPUT.PUT_LINE('CampusReserve utilisation report  '
                             || TO_CHAR(p_from, 'DD-Mon-YYYY') || ' to ' || TO_CHAR(p_to, 'DD-Mon-YYYY'));
        DBMS_OUTPUT.PUT_LINE(RPAD('-', 64, '-'));
        DBMS_OUTPUT.PUT_LINE(RPAD('CODE', 14) || RPAD('RESOURCE', 30) || RPAD('CATEGORY', 14) || 'UTIL %');
        FOR rec IN (SELECT r.resource_id, r.resource_code, r.resource_name, c.category_code
                      FROM resources r JOIN resource_categories c ON c.category_id = r.category_id
                     WHERE r.status <> 'RETIRED'
                     ORDER BY c.category_code, r.resource_code)
        LOOP
            v_pct := fn_resource_utilisation(rec.resource_id, p_from, p_to);
            DBMS_OUTPUT.PUT_LINE(RPAD(rec.resource_code, 14)
                                 || RPAD(SUBSTR(rec.resource_name, 1, 28), 30)
                                 || RPAD(rec.category_code, 14)
                                 || TO_CHAR(v_pct, '990.00'));
            v_total_pct := v_total_pct + v_pct;
            v_n := v_n + 1;
        END LOOP;
        DBMS_OUTPUT.PUT_LINE(RPAD('-', 64, '-'));
        DBMS_OUTPUT.PUT_LINE('Resources: ' || v_n || '   Mean utilisation: '
                             || CASE WHEN v_n > 0 THEN TO_CHAR(v_total_pct / v_n, '990.00') ELSE 'n/a' END || ' %');
    END print_utilisation_report;

END pkg_resource_analytics;
/
