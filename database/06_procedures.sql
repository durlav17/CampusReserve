--------------------------------------------------------------------------------
-- CampusReserve | 06_procedures.sql
-- PURPOSE : Stand-alone stored procedures - the ONLY write path the API uses
--           for bookings and maintenance.
--
-- TRANSACTION CONTRACT
--   None of these procedures COMMIT or ROLLBACK. The caller (the Node.js API,
--   or a SQL*Plus test script) owns the transaction and decides when to commit.
--   This keeps a multi-step API operation atomic and lets tests roll back.
--
-- CONCURRENCY CONTRACT
--   Every write that depends on the current state of a resource first locks
--   that resource row with SELECT ... FOR UPDATE WAIT 5. All writers therefore
--   queue on the same row, and the overlap check that follows sees every
--   committed competing booking. Lock order is always RESOURCE -> BOOKING /
--   MAINTENANCE_REQUEST to avoid deadlocks.
--
-- APPLICATION ERROR CODES (mapped to HTTP status codes by the API)
--   -20001 invalid interval          -20011 invalid status transition
--   -20002 resource not found        -20012 not authorised
--   -20003 resource in maintenance   -20013 user not found / inactive
--   -20004 resource retired          -20014 maintenance request not found
--   -20005 booking conflict          -20015 start time in the past
--   -20006 capacity exceeded         -20016 invalid argument
--   -20007 blackout period           -20017 overlap caught by trigger
--   -20008 outside operating hours   -20018 resource busy (lock timeout)
--   -20009 exceeds maximum duration  -20019 insufficient notice
--   -20010 booking not found
--------------------------------------------------------------------------------
SET DEFINE OFF

-- 1. CREATE BOOKING ---------------------------------------------------------------
-- IN : p_resource_id, p_user_id, p_title, p_purpose, p_attendees, p_start, p_end,
--      p_request_key (optional idempotency key supplied by the client)
-- OUT: o_booking_id, o_status (PENDING | APPROVED), o_duplicate (1 = an earlier
--      request with the same key already exists and is returned unchanged)
CREATE OR REPLACE PROCEDURE sp_create_booking (
    p_resource_id  IN  bookings.resource_id%TYPE,
    p_user_id      IN  bookings.requested_by%TYPE,
    p_title        IN  bookings.title%TYPE,
    p_purpose      IN  bookings.purpose%TYPE,
    p_attendees    IN  bookings.attendees%TYPE,
    p_start        IN  bookings.start_time%TYPE,
    p_end          IN  bookings.end_time%TYPE,
    p_request_key  IN  bookings.request_key%TYPE,
    o_booking_id   OUT bookings.booking_id%TYPE,
    o_status       OUT bookings.status%TYPE,
    o_duplicate    OUT NUMBER
)
IS
    e_lock_timeout EXCEPTION;
    PRAGMA EXCEPTION_INIT(e_lock_timeout, -30006);

    v_role_code     roles.role_code%TYPE;
    v_can_approve   roles.can_approve%TYPE;
    v_res_status    resources.status%TYPE;
    v_capacity      resources.capacity%TYPE;
    v_open          resources.opens_at_hour%TYPE;
    v_close         resources.closes_at_hour%TYPE;
    v_res_name      resources.resource_name%TYPE;
    v_res_dept      resources.managed_by_dept%TYPE;
    v_requires_appr resource_categories.requires_approval%TYPE;
    v_max_hours     resource_categories.max_booking_hours%TYPE;
    v_notice_hours  resource_categories.min_notice_hours%TYPE;
    v_conflict_id   bookings.booking_id%TYPE;
    v_day_start     TIMESTAMP;
    v_count         PLS_INTEGER;
BEGIN
    o_duplicate := 0;

    -- (a) Requester must exist and be active.
    BEGIN
        SELECT ro.role_code, ro.can_approve
          INTO v_role_code, v_can_approve
          FROM users u JOIN roles ro ON ro.role_id = u.role_id
         WHERE u.user_id = p_user_id AND u.is_active = 'Y';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20013, 'User ' || p_user_id || ' not found or inactive.');
    END;

    -- (b) Idempotency: a retried request returns the original booking.
    IF p_request_key IS NOT NULL THEN
        BEGIN
            SELECT booking_id, status INTO o_booking_id, o_status
              FROM bookings
             WHERE request_key = p_request_key AND requested_by = p_user_id;
            o_duplicate := 1;
            RETURN;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN NULL;
        END;
    END IF;

    -- (c) Interval sanity (cheap checks before taking any lock).
    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RAISE_APPLICATION_ERROR(-20001, 'End time must be later than start time.');
    END IF;
    IF p_start <= SYSTIMESTAMP THEN
        RAISE_APPLICATION_ERROR(-20015, 'Bookings must start in the future.');
    END IF;
    IF p_attendees IS NULL OR p_attendees < 1 THEN
        RAISE_APPLICATION_ERROR(-20016, 'Attendees must be at least 1.');
    END IF;

    -- (d) SERIALISATION POINT: lock the resource row. A concurrent caller for the
    --     same resource waits here (up to 5 s) until this transaction ends.
    BEGIN
        SELECT r.status, r.capacity, r.opens_at_hour, r.closes_at_hour, r.resource_name,
               r.managed_by_dept, c.requires_approval, c.max_booking_hours, c.min_notice_hours
          INTO v_res_status, v_capacity, v_open, v_close, v_res_name,
               v_res_dept, v_requires_appr, v_max_hours, v_notice_hours
          FROM resources r
          JOIN resource_categories c ON c.category_id = r.category_id
         WHERE r.resource_id = p_resource_id
           FOR UPDATE OF r.status WAIT 5;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20002, 'Resource ' || p_resource_id || ' does not exist.');
        WHEN e_lock_timeout THEN
            RAISE_APPLICATION_ERROR(-20018, 'Resource is busy with another booking; please retry.');
    END;

    -- (e) Resource-level rules (evaluated while holding the lock).
    IF v_res_status = 'MAINTENANCE' THEN
        RAISE_APPLICATION_ERROR(-20003, v_res_name || ' is under maintenance and cannot be booked.');
    ELSIF v_res_status = 'RETIRED' THEN
        RAISE_APPLICATION_ERROR(-20004, v_res_name || ' has been retired.');
    END IF;

    IF v_capacity > 0 AND p_attendees > v_capacity THEN
        RAISE_APPLICATION_ERROR(-20006, 'Attendees (' || p_attendees || ') exceed capacity ('
                                         || v_capacity || ').');
    END IF;

    v_day_start := CAST(TRUNC(CAST(p_start AS DATE)) AS TIMESTAMP);
    IF p_start < v_day_start + NUMTODSINTERVAL(v_open, 'HOUR')
       OR p_end > v_day_start + NUMTODSINTERVAL(v_close, 'HOUR') THEN
        RAISE_APPLICATION_ERROR(-20008, 'Bookings must fall within operating hours '
                                 || LPAD(v_open, 2, '0') || ':00-' || LPAD(v_close, 2, '0') || ':00 on one day.');
    END IF;

    IF fn_hours_between(p_start, p_end) > v_max_hours THEN
        RAISE_APPLICATION_ERROR(-20009, 'Maximum booking length for this category is '
                                         || v_max_hours || ' hours.');
    END IF;

    IF v_can_approve = 'N'
       AND p_start < SYSTIMESTAMP + NUMTODSINTERVAL(v_notice_hours, 'HOUR') THEN
        RAISE_APPLICATION_ERROR(-20019, 'This resource needs at least ' || v_notice_hours
                                         || ' hours notice.');
    END IF;

    SELECT COUNT(*) INTO v_count
      FROM resource_blackouts
     WHERE resource_id = p_resource_id
       AND start_time < p_end AND end_time > p_start;
    IF v_count > 0 THEN
        RAISE_APPLICATION_ERROR(-20007, 'The resource is blocked out during the requested time.');
    END IF;

    -- (f) Overlap check. [s1,e1) overlaps [s2,e2) iff s1 < e2 AND s2 < e1.
    --     PENDING requests also hold the slot so two users cannot both queue for it.
    SELECT MIN(booking_id) INTO v_conflict_id
      FROM bookings
     WHERE resource_id = p_resource_id
       AND status IN ('PENDING', 'APPROVED')
       AND start_time < p_end
       AND end_time   > p_start;
    IF v_conflict_id IS NOT NULL THEN
        RAISE_APPLICATION_ERROR(-20005, 'Time slot conflicts with booking #' || v_conflict_id || '.');
    END IF;

    -- (g) Accept. Approvers and categories without approval are auto-approved.
    o_status := CASE WHEN v_requires_appr = 'N' OR v_can_approve = 'Y'
                     THEN 'APPROVED' ELSE 'PENDING' END;

    INSERT INTO bookings (resource_id, requested_by, title, purpose, attendees,
                          start_time, end_time, status, request_key)
    VALUES (p_resource_id, p_user_id, TRIM(p_title), p_purpose, p_attendees,
            p_start, p_end, o_status, p_request_key)
    RETURNING booking_id INTO o_booking_id;

    IF v_requires_appr = 'Y' AND o_status = 'APPROVED' THEN
        INSERT INTO booking_approvals (booking_id, approver_id, decision, remarks)
        VALUES (o_booking_id, p_user_id, 'APPROVED', 'Auto-approved: requester holds approver role');
    END IF;

    INSERT INTO notifications (user_id, notif_type, title, message, booking_id)
    VALUES (p_user_id, 'BOOKING',
            CASE o_status WHEN 'APPROVED' THEN 'Booking confirmed' ELSE 'Booking submitted' END,
            v_res_name || ': ' || TO_CHAR(p_start, 'DD-Mon HH24:MI') || '-' || TO_CHAR(p_end, 'HH24:MI')
            || CASE o_status WHEN 'PENDING' THEN ' is awaiting approval.' ELSE ' is confirmed.' END,
            o_booking_id);

    IF o_status = 'PENDING' THEN
        -- Notify every approver who may decide this booking.
        INSERT INTO notifications (user_id, notif_type, title, message, booking_id)
        SELECT u.user_id, 'APPROVAL', 'Approval required',
               'New request #' || o_booking_id || ' for ' || v_res_name || '.', o_booking_id
          FROM users u JOIN roles ro ON ro.role_id = u.role_id
         WHERE u.is_active = 'Y'
           AND (ro.role_code = 'ADMIN'
                OR (ro.role_code = 'COORDINATOR' AND u.dept_id = v_res_dept));
    END IF;
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        -- Two retries with the same key raced past step (b): return the winner.
        IF p_request_key IS NULL THEN
            RAISE;
        END IF;
        BEGIN
            SELECT booking_id, status INTO o_booking_id, o_status
              FROM bookings
             WHERE request_key = p_request_key AND requested_by = p_user_id;
            o_duplicate := 1;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20016, 'This request key is already in use.');
        END;
END sp_create_booking;
/

-- 2. APPROVE / REJECT BOOKING ---------------------------------------------------
-- IN : p_booking_id, p_approver_id, p_decision ('APPROVED' | 'REJECTED'), p_remarks
-- Authorisation: ADMIN may decide any booking; COORDINATOR only bookings of
-- resources managed by the coordinator's own department.
CREATE OR REPLACE PROCEDURE sp_decide_booking (
    p_booking_id  IN bookings.booking_id%TYPE,
    p_approver_id IN users.user_id%TYPE,
    p_decision    IN booking_approvals.decision%TYPE,
    p_remarks     IN booking_approvals.remarks%TYPE
)
IS
    e_lock_timeout EXCEPTION;
    PRAGMA EXCEPTION_INIT(e_lock_timeout, -30006);
    v_role_code   roles.role_code%TYPE;
    v_appr_dept   users.dept_id%TYPE;
    v_resource_id bookings.resource_id%TYPE;
    v_res_dept    resources.managed_by_dept%TYPE;
    v_res_status  resources.status%TYPE;
    v_res_name    resources.resource_name%TYPE;
    v_status      bookings.status%TYPE;
    v_start       bookings.start_time%TYPE;
    v_end         bookings.end_time%TYPE;
    v_requester   bookings.requested_by%TYPE;
    v_conflict_id bookings.booking_id%TYPE;
BEGIN
    IF p_decision NOT IN ('APPROVED', 'REJECTED') OR p_decision IS NULL THEN
        RAISE_APPLICATION_ERROR(-20016, 'Decision must be APPROVED or REJECTED.');
    END IF;
    IF p_decision = 'REJECTED' AND TRIM(p_remarks) IS NULL THEN
        RAISE_APPLICATION_ERROR(-20016, 'A reason is required when rejecting a booking.');
    END IF;

    BEGIN
        SELECT ro.role_code, u.dept_id INTO v_role_code, v_appr_dept
          FROM users u JOIN roles ro ON ro.role_id = u.role_id
         WHERE u.user_id = p_approver_id AND u.is_active = 'Y' AND ro.can_approve = 'Y';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20012, 'User ' || p_approver_id || ' is not allowed to approve bookings.');
    END;

    -- Find the resource without locking, then lock in the global order RESOURCE -> BOOKING.
    BEGIN
        SELECT resource_id INTO v_resource_id FROM bookings WHERE booking_id = p_booking_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20010, 'Booking ' || p_booking_id || ' does not exist.');
    END;

    BEGIN
        SELECT managed_by_dept, status, resource_name INTO v_res_dept, v_res_status, v_res_name
          FROM resources WHERE resource_id = v_resource_id
           FOR UPDATE WAIT 5;
        SELECT status, start_time, end_time, requested_by
          INTO v_status, v_start, v_end, v_requester
          FROM bookings WHERE booking_id = p_booking_id
           FOR UPDATE WAIT 5;
    EXCEPTION
        WHEN e_lock_timeout THEN
            RAISE_APPLICATION_ERROR(-20018, 'Booking is being modified by another user; please retry.');
    END;

    IF v_role_code = 'COORDINATOR' AND v_appr_dept <> v_res_dept THEN
        RAISE_APPLICATION_ERROR(-20012, 'Coordinators may only decide bookings for their own department''s resources.');
    END IF;
    IF v_status <> 'PENDING' THEN
        RAISE_APPLICATION_ERROR(-20011, 'Only PENDING bookings can be decided (current: ' || v_status || ').');
    END IF;

    IF p_decision = 'APPROVED' THEN
        IF v_start <= SYSTIMESTAMP THEN
            RAISE_APPLICATION_ERROR(-20015, 'Cannot approve a booking whose start time has passed.');
        END IF;
        IF v_res_status <> 'AVAILABLE' THEN
            RAISE_APPLICATION_ERROR(-20003, v_res_name || ' is not available (' || v_res_status || ').');
        END IF;
        -- Defensive re-check: no other APPROVED booking may overlap.
        SELECT MIN(booking_id) INTO v_conflict_id
          FROM bookings
         WHERE resource_id = v_resource_id AND status = 'APPROVED'
           AND booking_id <> p_booking_id
           AND start_time < v_end AND end_time > v_start;
        IF v_conflict_id IS NOT NULL THEN
            RAISE_APPLICATION_ERROR(-20005, 'Conflicts with approved booking #' || v_conflict_id || '.');
        END IF;
    END IF;

    UPDATE bookings SET status = p_decision WHERE booking_id = p_booking_id;

    INSERT INTO booking_approvals (booking_id, approver_id, decision, remarks)
    VALUES (p_booking_id, p_approver_id, p_decision, p_remarks);

    INSERT INTO notifications (user_id, notif_type, title, message, booking_id)
    VALUES (v_requester, 'APPROVAL',
            'Booking ' || LOWER(p_decision),
            v_res_name || ' on ' || TO_CHAR(v_start, 'DD-Mon HH24:MI') || ' was ' || LOWER(p_decision)
            || CASE WHEN p_remarks IS NOT NULL THEN ': ' || SUBSTR(p_remarks, 1, 200) END,
            p_booking_id);
END sp_decide_booking;
/

-- 3. CANCEL BOOKING --------------------------------------------------------------
-- The requester may cancel their own booking; approvers/admins may cancel any.
-- Cancelling frees the slot immediately because the overlap check only
-- considers PENDING and APPROVED rows.
CREATE OR REPLACE PROCEDURE sp_cancel_booking (
    p_booking_id IN bookings.booking_id%TYPE,
    p_user_id    IN users.user_id%TYPE,
    p_reason     IN bookings.cancel_reason%TYPE
)
IS
    e_lock_timeout EXCEPTION;
    PRAGMA EXCEPTION_INIT(e_lock_timeout, -30006);
    v_can_approve roles.can_approve%TYPE;
    v_requester   bookings.requested_by%TYPE;
    v_status      bookings.status%TYPE;
    v_end         bookings.end_time%TYPE;
    v_start       bookings.start_time%TYPE;
    v_resource_id bookings.resource_id%TYPE;
BEGIN
    BEGIN
        SELECT ro.can_approve INTO v_can_approve
          FROM users u JOIN roles ro ON ro.role_id = u.role_id
         WHERE u.user_id = p_user_id AND u.is_active = 'Y';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20013, 'User ' || p_user_id || ' not found or inactive.');
    END;

    BEGIN
        SELECT resource_id INTO v_resource_id FROM bookings WHERE booking_id = p_booking_id;
        -- Same lock order as booking creation: resource first.
        SELECT resource_id INTO v_resource_id FROM resources
         WHERE resource_id = v_resource_id FOR UPDATE WAIT 5;
        SELECT requested_by, status, start_time, end_time
          INTO v_requester, v_status, v_start, v_end
          FROM bookings WHERE booking_id = p_booking_id FOR UPDATE WAIT 5;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20010, 'Booking ' || p_booking_id || ' does not exist.');
        WHEN e_lock_timeout THEN
            RAISE_APPLICATION_ERROR(-20018, 'Booking is being modified by another user; please retry.');
    END;

    IF v_requester <> p_user_id AND v_can_approve = 'N' THEN
        RAISE_APPLICATION_ERROR(-20012, 'You can only cancel your own bookings.');
    END IF;
    IF v_status NOT IN ('PENDING', 'APPROVED') THEN
        RAISE_APPLICATION_ERROR(-20011, 'Booking is already ' || v_status || '.');
    END IF;
    IF v_end <= SYSTIMESTAMP THEN
        RAISE_APPLICATION_ERROR(-20011, 'A booking that has already ended cannot be cancelled.');
    END IF;

    UPDATE bookings
       SET status = 'CANCELLED',
           cancelled_at = SYSTIMESTAMP,
           cancel_reason = NVL(TRIM(p_reason), 'No reason given')
     WHERE booking_id = p_booking_id;

    IF v_requester <> p_user_id THEN
        INSERT INTO notifications (user_id, notif_type, title, message, booking_id)
        VALUES (v_requester, 'BOOKING', 'Booking cancelled by staff',
                'Your booking #' || p_booking_id || ' on ' || TO_CHAR(v_start, 'DD-Mon HH24:MI')
                || ' was cancelled: ' || SUBSTR(NVL(p_reason, 'no reason given'), 1, 200),
                p_booking_id);
    END IF;
END sp_cancel_booking;
/

-- 4. SUBMIT MAINTENANCE REQUEST -----------------------------------------------
-- p_blocks_booking = 'Y' takes the resource out of service immediately; only
-- staff (faculty, coordinators, admins) may do that. Holders of upcoming
-- bookings on the resource are notified through a cursor FOR loop.
CREATE OR REPLACE PROCEDURE sp_submit_maintenance (
    p_resource_id    IN  maintenance_requests.resource_id%TYPE,
    p_user_id        IN  maintenance_requests.reported_by%TYPE,
    p_title          IN  maintenance_requests.title%TYPE,
    p_description    IN  maintenance_requests.description%TYPE,
    p_priority       IN  maintenance_requests.priority%TYPE,
    p_blocks_booking IN  maintenance_requests.blocks_booking%TYPE,
    o_request_id     OUT maintenance_requests.request_id%TYPE
)
IS
    v_role_code roles.role_code%TYPE;
    v_res_name  resources.resource_name%TYPE;
    v_res_dept  resources.managed_by_dept%TYPE;
    v_blocks    CHAR(1) := NVL(UPPER(p_blocks_booking), 'N');
BEGIN
    IF NVL(UPPER(p_priority), 'X') NOT IN ('LOW','MEDIUM','HIGH','CRITICAL') THEN
        RAISE_APPLICATION_ERROR(-20016, 'Priority must be LOW, MEDIUM, HIGH or CRITICAL.');
    END IF;
    IF v_blocks NOT IN ('Y', 'N') THEN
        RAISE_APPLICATION_ERROR(-20016, 'blocks_booking must be Y or N.');
    END IF;

    BEGIN
        SELECT ro.role_code INTO v_role_code
          FROM users u JOIN roles ro ON ro.role_id = u.role_id
         WHERE u.user_id = p_user_id AND u.is_active = 'Y';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20013, 'User ' || p_user_id || ' not found or inactive.');
    END;
    IF v_blocks = 'Y' AND v_role_code = 'STUDENT' THEN
        RAISE_APPLICATION_ERROR(-20012, 'Only staff can take a resource out of service.');
    END IF;

    BEGIN
        SELECT resource_name, managed_by_dept INTO v_res_name, v_res_dept
          FROM resources WHERE resource_id = p_resource_id
           FOR UPDATE WAIT 5;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20002, 'Resource ' || p_resource_id || ' does not exist.');
    END;

    INSERT INTO maintenance_requests (resource_id, reported_by, title, description,
                                      priority, status, blocks_booking)
    VALUES (p_resource_id, p_user_id, TRIM(p_title), p_description,
            UPPER(p_priority), 'OPEN', v_blocks)
    RETURNING request_id INTO o_request_id;

    IF v_blocks = 'Y' THEN
        UPDATE resources SET status = 'MAINTENANCE', updated_at = SYSTIMESTAMP
         WHERE resource_id = p_resource_id AND status = 'AVAILABLE';

        -- Cursor FOR loop: warn everyone holding an upcoming booking.
        FOR b IN (SELECT booking_id, requested_by, start_time
                    FROM bookings
                   WHERE resource_id = p_resource_id
                     AND status IN ('PENDING', 'APPROVED')
                     AND end_time > SYSTIMESTAMP)
        LOOP
            INSERT INTO notifications (user_id, notif_type, title, message, booking_id)
            VALUES (b.requested_by, 'MAINTENANCE', 'Resource under maintenance',
                    v_res_name || ' was taken out of service. Your booking on '
                    || TO_CHAR(b.start_time, 'DD-Mon HH24:MI') || ' may be affected.',
                    b.booking_id);
        END LOOP;
    END IF;

    -- Alert the staff responsible for the resource.
    INSERT INTO notifications (user_id, notif_type, title, message)
    SELECT u.user_id, 'MAINTENANCE', 'New maintenance request',
           '[' || UPPER(p_priority) || '] ' || v_res_name || ': ' || SUBSTR(p_title, 1, 100)
      FROM users u JOIN roles ro ON ro.role_id = u.role_id
     WHERE u.is_active = 'Y'
       AND (ro.role_code = 'ADMIN' OR (ro.role_code = 'COORDINATOR' AND u.dept_id = v_res_dept));
END sp_submit_maintenance;
/

-- 5. UPDATE MAINTENANCE STATUS -----------------------------------------------------
-- Moves a ticket through OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED (transition
-- rules are enforced by TRG_MAINTENANCE_BIU) and then recomputes the resource
-- status: MAINTENANCE while any blocking ticket is open, otherwise AVAILABLE.
CREATE OR REPLACE PROCEDURE sp_update_maintenance_status (
    p_request_id  IN maintenance_requests.request_id%TYPE,
    p_actor_id    IN users.user_id%TYPE,
    p_new_status  IN maintenance_requests.status%TYPE,
    p_assigned_to IN maintenance_requests.assigned_to%TYPE,
    p_notes       IN maintenance_requests.resolution_notes%TYPE
)
IS
    v_can_approve  roles.can_approve%TYPE;
    v_resource_id  maintenance_requests.resource_id%TYPE;
    v_reporter     maintenance_requests.reported_by%TYPE;
    v_title        maintenance_requests.title%TYPE;
    v_res_status   resources.status%TYPE;
    v_open_blocks  PLS_INTEGER;
BEGIN
    IF NVL(UPPER(p_new_status), 'X') NOT IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED') THEN
        RAISE_APPLICATION_ERROR(-20016, 'Unknown maintenance status: ' || p_new_status);
    END IF;

    BEGIN
        SELECT ro.can_approve INTO v_can_approve
          FROM users u JOIN roles ro ON ro.role_id = u.role_id
         WHERE u.user_id = p_actor_id AND u.is_active = 'Y';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20013, 'User ' || p_actor_id || ' not found or inactive.');
    END;
    IF v_can_approve = 'N' THEN
        RAISE_APPLICATION_ERROR(-20012, 'Only coordinators and administrators manage maintenance.');
    END IF;

    BEGIN
        SELECT resource_id INTO v_resource_id
          FROM maintenance_requests WHERE request_id = p_request_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20014, 'Maintenance request ' || p_request_id || ' does not exist.');
    END;

    -- Lock order: resource, then ticket.
    SELECT status INTO v_res_status FROM resources
     WHERE resource_id = v_resource_id FOR UPDATE WAIT 5;
    SELECT reported_by, title INTO v_reporter, v_title
      FROM maintenance_requests WHERE request_id = p_request_id FOR UPDATE WAIT 5;

    UPDATE maintenance_requests
       SET status           = UPPER(p_new_status),
           assigned_to      = NVL(p_assigned_to, assigned_to),
           resolution_notes = NVL(p_notes, resolution_notes)
     WHERE request_id = p_request_id;

    SELECT COUNT(*) INTO v_open_blocks
      FROM maintenance_requests
     WHERE resource_id = v_resource_id
       AND blocks_booking = 'Y'
       AND status IN ('OPEN', 'IN_PROGRESS');

    IF v_open_blocks > 0 AND v_res_status = 'AVAILABLE' THEN
        UPDATE resources SET status = 'MAINTENANCE', updated_at = SYSTIMESTAMP
         WHERE resource_id = v_resource_id;
    ELSIF v_open_blocks = 0 AND v_res_status = 'MAINTENANCE' THEN
        UPDATE resources SET status = 'AVAILABLE', updated_at = SYSTIMESTAMP
         WHERE resource_id = v_resource_id;
    END IF;

    INSERT INTO notifications (user_id, notif_type, title, message)
    VALUES (v_reporter, 'MAINTENANCE', 'Maintenance update',
            'Your request "' || SUBSTR(v_title, 1, 80) || '" is now ' || UPPER(p_new_status) || '.');
END sp_update_maintenance_status;
/
