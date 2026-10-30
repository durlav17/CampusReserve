--------------------------------------------------------------------------------
-- CampusReserve | 09_triggers.sql
-- PURPOSE : Row-level validation, a COMPOUND trigger for overlap detection,
--           and audit triggers.
--
-- MUTATING-TABLE SAFETY
--   A row-level trigger on BOOKINGS may not query BOOKINGS (ORA-04091). The
--   overlap check therefore runs in the AFTER STATEMENT section of a compound
--   trigger, when the table is no longer mutating. Row-level triggers only read
--   OTHER tables (RESOURCES), which is allowed.
--
-- ACTOR ATTRIBUTION
--   The API sets the Oracle CLIENT_IDENTIFIER to the signed-in user's ID on every
--   call (node-oracledb: connection.clientId). Audit triggers read it with
--   SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER') (via FN_CURRENT_ACTOR) and fall back to the row's own
--   user column when it is not set (e.g. SQL*Plus sessions).
--------------------------------------------------------------------------------
SET DEFINE OFF

-- 1. USERS: normalise e-mail so UNIQUE(email) is effectively case-insensitive
CREATE OR REPLACE TRIGGER trg_users_biu
BEFORE INSERT OR UPDATE OF email, full_name ON users
FOR EACH ROW
BEGIN
    :NEW.email     := LOWER(TRIM(:NEW.email));
    :NEW.full_name := TRIM(:NEW.full_name);
END;
/

-- 2. RESOURCES: maintain updated_at
CREATE OR REPLACE TRIGGER trg_resources_bu
BEFORE UPDATE ON resources
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

-- 3. BOOKINGS: row validation and status state machine
--    INSERT : new rows must be PENDING or APPROVED; resource must be AVAILABLE;
--             attendees must fit the room.
--    UPDATE : PENDING  -> APPROVED | REJECTED | CANCELLED
--             APPROVED -> CANCELLED
--             REJECTED / CANCELLED are final.
CREATE OR REPLACE TRIGGER trg_bookings_biu
BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW
DECLARE
    v_res_status resources.status%TYPE;
    v_capacity   resources.capacity%TYPE;
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;

    IF INSERTING THEN
        IF :NEW.status NOT IN ('PENDING', 'APPROVED') THEN
            RAISE_APPLICATION_ERROR(-20011, 'New bookings must be PENDING or APPROVED.');
        END IF;
        SELECT status, capacity INTO v_res_status, v_capacity
          FROM resources WHERE resource_id = :NEW.resource_id;
        IF v_res_status = 'MAINTENANCE' THEN
            RAISE_APPLICATION_ERROR(-20003, 'Resource is under maintenance.');
        ELSIF v_res_status = 'RETIRED' THEN
            RAISE_APPLICATION_ERROR(-20004, 'Resource has been retired.');
        END IF;
        IF v_capacity > 0 AND :NEW.attendees > v_capacity THEN
            RAISE_APPLICATION_ERROR(-20006, 'Attendees exceed resource capacity.');
        END IF;
    END IF;

    IF UPDATING THEN
        IF :OLD.status <> :NEW.status THEN
            IF NOT (   (:OLD.status = 'PENDING'  AND :NEW.status IN ('APPROVED','REJECTED','CANCELLED'))
                    OR (:OLD.status = 'APPROVED' AND :NEW.status = 'CANCELLED')) THEN
                RAISE_APPLICATION_ERROR(-20011, 'Illegal booking status change '
                                         || :OLD.status || ' -> ' || :NEW.status || '.');
            END IF;
        END IF;
        IF :NEW.status = 'CANCELLED' AND :NEW.cancelled_at IS NULL THEN
            :NEW.cancelled_at := SYSTIMESTAMP;
        END IF;
        -- Time / resource can only be edited while the booking is still live.
        IF (   :OLD.start_time  <> :NEW.start_time
            OR :OLD.end_time    <> :NEW.end_time
            OR :OLD.resource_id <> :NEW.resource_id)
           AND :OLD.status NOT IN ('PENDING', 'APPROVED') THEN
            RAISE_APPLICATION_ERROR(-20011, 'A ' || :OLD.status || ' booking cannot be rescheduled.');
        END IF;
    END IF;
END;
/

-- 4. BOOKINGS: defence-in-depth overlap detection (COMPOUND trigger)
--    Catches overlaps created by ANY writer (ad-hoc SQL, a buggy script), not
--    just SP_CREATE_BOOKING. It cannot by itself stop two *concurrent*
--    transactions (each sees only its own uncommitted row) - that is what the
--    resource row lock in SP_CREATE_BOOKING is for. See 12_transaction_tests.sql.
CREATE OR REPLACE TRIGGER trg_bookings_no_overlap
FOR INSERT OR UPDATE OF start_time, end_time, status, resource_id ON bookings
COMPOUND TRIGGER
    TYPE t_ids IS TABLE OF bookings.booking_id%TYPE;
    g_ids t_ids := t_ids();

    AFTER EACH ROW IS
    BEGIN
        IF :NEW.status IN ('PENDING', 'APPROVED') THEN
            g_ids.EXTEND;
            g_ids(g_ids.LAST) := :NEW.booking_id;
        END IF;
    END AFTER EACH ROW;

    AFTER STATEMENT IS
        v_conflict bookings.booking_id%TYPE;
    BEGIN
        FOR i IN 1 .. g_ids.COUNT LOOP
            SELECT MIN(o.booking_id) INTO v_conflict
              FROM bookings b
              JOIN bookings o
                ON o.resource_id = b.resource_id
               AND o.booking_id <> b.booking_id
               AND o.status IN ('PENDING', 'APPROVED')
               AND o.start_time < b.end_time
               AND o.end_time   > b.start_time
             WHERE b.booking_id = g_ids(i);
            IF v_conflict IS NOT NULL THEN
                RAISE_APPLICATION_ERROR(-20017, 'Booking #' || g_ids(i)
                                         || ' overlaps booking #' || v_conflict || '.');
            END IF;
        END LOOP;
        g_ids.DELETE;
    END AFTER STATEMENT;
END trg_bookings_no_overlap;
/

-- 5. BOOKINGS: audit trail
CREATE OR REPLACE TRIGGER trg_bookings_audit
AFTER INSERT OR UPDATE OR DELETE ON bookings
FOR EACH ROW
DECLARE
    v_actor   NUMBER := fn_current_actor;
    v_details VARCHAR2(1000);
BEGIN
    IF INSERTING THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_status, changed_by, details)
        VALUES ('BOOKINGS', :NEW.booking_id, 'INSERT', :NEW.status, NVL(v_actor, :NEW.requested_by),
                'resource=' || :NEW.resource_id
                || '; slot=' || TO_CHAR(:NEW.start_time, 'YYYY-MM-DD HH24:MI')
                || '..' || TO_CHAR(:NEW.end_time, 'HH24:MI')
                || '; attendees=' || :NEW.attendees);
    ELSIF UPDATING THEN
        IF :OLD.status <> :NEW.status THEN
            v_details := 'status changed';
        END IF;
        IF :OLD.start_time <> :NEW.start_time OR :OLD.end_time <> :NEW.end_time THEN
            v_details := v_details || CASE WHEN v_details IS NOT NULL THEN '; ' END
                      || 'rescheduled from ' || TO_CHAR(:OLD.start_time, 'YYYY-MM-DD HH24:MI');
        END IF;
        IF :NEW.status = 'CANCELLED' AND :OLD.status <> 'CANCELLED' THEN
            v_details := v_details || '; reason=' || SUBSTR(:NEW.cancel_reason, 1, 300);
        END IF;
        INSERT INTO audit_logs (table_name, record_id, action, old_status, new_status, changed_by, details)
        VALUES ('BOOKINGS', :NEW.booking_id, 'UPDATE', :OLD.status, :NEW.status,
                NVL(v_actor, :NEW.requested_by), NVL(v_details, 'fields updated'));
    ELSE
        INSERT INTO audit_logs (table_name, record_id, action, old_status, changed_by, details)
        VALUES ('BOOKINGS', :OLD.booking_id, 'DELETE', :OLD.status, v_actor,
                'row deleted; resource=' || :OLD.resource_id);
    END IF;
END;
/

-- 6. MAINTENANCE_REQUESTS: validation and ticket state machine
--    OPEN -> IN_PROGRESS | RESOLVED | CLOSED
--    IN_PROGRESS -> OPEN | RESOLVED | CLOSED
--    RESOLVED -> CLOSED | OPEN (re-open)
--    CLOSED is final.
CREATE OR REPLACE TRIGGER trg_maintenance_biu
BEFORE INSERT OR UPDATE ON maintenance_requests
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;

    IF INSERTING AND :NEW.status <> 'OPEN' THEN
        RAISE_APPLICATION_ERROR(-20011, 'New maintenance requests must start as OPEN.');
    END IF;

    IF UPDATING AND :OLD.status <> :NEW.status THEN
        IF NOT (   (:OLD.status = 'OPEN'        AND :NEW.status IN ('IN_PROGRESS','RESOLVED','CLOSED'))
                OR (:OLD.status = 'IN_PROGRESS' AND :NEW.status IN ('OPEN','RESOLVED','CLOSED'))
                OR (:OLD.status = 'RESOLVED'    AND :NEW.status IN ('CLOSED','OPEN'))) THEN
            RAISE_APPLICATION_ERROR(-20011, 'Illegal maintenance status change '
                                     || :OLD.status || ' -> ' || :NEW.status || '.');
        END IF;
    END IF;

    -- Keep resolved_at consistent with status (also enforced by ck_maint_resolved).
    IF :NEW.status IN ('RESOLVED', 'CLOSED') AND :NEW.resolved_at IS NULL THEN
        :NEW.resolved_at := SYSTIMESTAMP;
    ELSIF :NEW.status IN ('OPEN', 'IN_PROGRESS') THEN
        :NEW.resolved_at := NULL;
    END IF;
END;
/

-- 7. MAINTENANCE_REQUESTS: audit trail
CREATE OR REPLACE TRIGGER trg_maintenance_audit
AFTER INSERT OR UPDATE ON maintenance_requests
FOR EACH ROW
DECLARE
    v_actor   NUMBER := fn_current_actor;
    v_details VARCHAR2(1000);
BEGIN
    IF INSERTING THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_status, changed_by, details)
        VALUES ('MAINTENANCE_REQUESTS', :NEW.request_id, 'INSERT', :NEW.status,
                NVL(v_actor, :NEW.reported_by),
                'resource=' || :NEW.resource_id || '; priority=' || :NEW.priority
                || '; blocks_booking=' || :NEW.blocks_booking);
    ELSE
        IF :OLD.priority <> :NEW.priority THEN
            v_details := 'priority ' || :OLD.priority || ' -> ' || :NEW.priority;
        END IF;
        IF NVL(:OLD.assigned_to, -1) <> NVL(:NEW.assigned_to, -1) THEN
            v_details := v_details || CASE WHEN v_details IS NOT NULL THEN '; ' END
                      || 'assigned_to ' || NVL(TO_CHAR(:OLD.assigned_to), 'none')
                      || ' -> ' || NVL(TO_CHAR(:NEW.assigned_to), 'none');
        END IF;
        INSERT INTO audit_logs (table_name, record_id, action, old_status, new_status, changed_by, details)
        VALUES ('MAINTENANCE_REQUESTS', :NEW.request_id, 'UPDATE', :OLD.status, :NEW.status,
                v_actor, NVL(v_details, CASE WHEN :OLD.status <> :NEW.status
                                             THEN 'status changed' ELSE 'fields updated' END));
    END IF;
END;
/

-- 8. RESOURCES: audit availability changes
CREATE OR REPLACE TRIGGER trg_resources_status_audit
AFTER UPDATE OF status ON resources
FOR EACH ROW
WHEN (OLD.status <> NEW.status)
BEGIN
    INSERT INTO audit_logs (table_name, record_id, action, old_status, new_status, changed_by, details)
    VALUES ('RESOURCES', :NEW.resource_id, 'UPDATE', :OLD.status, :NEW.status,
            fn_current_actor,
            'resource availability changed');
END;
/

-- 9. AUDIT_LOGS: append-only
CREATE OR REPLACE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
BEGIN
    RAISE_APPLICATION_ERROR(-20012, 'AUDIT_LOGS is append-only.');
END;
/
