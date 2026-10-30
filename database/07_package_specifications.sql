--------------------------------------------------------------------------------
-- CampusReserve | 07_package_specifications.sql
-- PURPOSE : Public interfaces of the two packages. Bodies are in 08_*.sql.
--   PKG_CAMPUS_RESERVATIONS - reservation workflow helpers: named exceptions,
--                             calendar slot generator, approval-queue cursors.
--   PKG_RESOURCE_ANALYTICS  - utilisation, trends and maintenance reporting.
-- Like the stand-alone procedures, nothing here issues COMMIT.
--------------------------------------------------------------------------------
SET DEFINE OFF

CREATE OR REPLACE PACKAGE pkg_campus_reservations AS
    -- Status constants (single source of truth for PL/SQL callers)
    c_pending   CONSTANT VARCHAR2(12) := 'PENDING';
    c_approved  CONSTANT VARCHAR2(12) := 'APPROVED';
    c_rejected  CONSTANT VARCHAR2(12) := 'REJECTED';
    c_cancelled CONSTANT VARCHAR2(12) := 'CANCELLED';

    -- Named exceptions for the application error codes raised by SP_* procedures,
    -- so PL/SQL callers can write  WHEN pkg_campus_reservations.e_booking_conflict
    e_invalid_interval   EXCEPTION; PRAGMA EXCEPTION_INIT(e_invalid_interval,   -20001);
    e_resource_missing   EXCEPTION; PRAGMA EXCEPTION_INIT(e_resource_missing,   -20002);
    e_under_maintenance  EXCEPTION; PRAGMA EXCEPTION_INIT(e_under_maintenance,  -20003);
    e_booking_conflict   EXCEPTION; PRAGMA EXCEPTION_INIT(e_booking_conflict,   -20005);
    e_capacity_exceeded  EXCEPTION; PRAGMA EXCEPTION_INIT(e_capacity_exceeded,  -20006);
    e_invalid_transition EXCEPTION; PRAGMA EXCEPTION_INIT(e_invalid_transition, -20011);
    e_not_authorised     EXCEPTION; PRAGMA EXCEPTION_INIT(e_not_authorised,     -20012);
    e_overlap_trigger    EXCEPTION; PRAGMA EXCEPTION_INIT(e_overlap_trigger,    -20017);
    e_resource_busy      EXCEPTION; PRAGMA EXCEPTION_INIT(e_resource_busy,      -20018);

    -- One calendar cell
    TYPE t_slot IS RECORD (
        slot_start  TIMESTAMP,
        slot_end    TIMESTAMP,
        slot_state  VARCHAR2(12),    -- FREE | BOOKED | PENDING | BLACKOUT | PAST | CLOSED
        booking_id  NUMBER
    );
    TYPE t_slot_tab IS TABLE OF t_slot;

    -- Pipelined table function: SELECT * FROM TABLE(pkg_campus_reservations.day_slots(1, DATE '2026-11-02'))
    FUNCTION day_slots (
        p_resource_id  IN NUMBER,
        p_day          IN DATE,
        p_slot_minutes IN NUMBER DEFAULT 60
    ) RETURN t_slot_tab PIPELINED;

    -- Bookings and blackouts of one resource in [p_from, p_to) for the calendar UI.
    FUNCTION resource_schedule (
        p_resource_id IN NUMBER,
        p_from        IN TIMESTAMP,
        p_to          IN TIMESTAMP
    ) RETURN SYS_REFCURSOR;

    -- Pending bookings the given approver is authorised to decide.
    FUNCTION pending_for_approver (p_approver_id IN NUMBER) RETURN SYS_REFCURSOR;

    -- EXPLICIT CURSOR: builds one digest notification listing the approver's queue.
    -- OUT o_pending_count = number of bookings included in the digest.
    PROCEDURE send_pending_digest (
        p_approver_id   IN  NUMBER,
        o_pending_count OUT NUMBER
    );

    -- EXPLICIT CURSOR ... FOR UPDATE SKIP LOCKED: auto-rejects PENDING bookings
    -- whose start time has already passed without a decision.
    PROCEDURE expire_stale_pending (
        p_actor_id  IN  NUMBER,
        o_expired   OUT NUMBER
    );
END pkg_campus_reservations;
/

CREATE OR REPLACE PACKAGE pkg_resource_analytics AS
    -- Thin wrapper so analytics code has one entry point.
    FUNCTION utilisation (
        p_resource_id IN NUMBER,
        p_from        IN DATE,
        p_to          IN DATE
    ) RETURN NUMBER;

    -- KPI row for the dashboard.
    FUNCTION dashboard_summary RETURN SYS_REFCURSOR;

    -- Bookings per day for the last p_days days (status breakdown).
    FUNCTION booking_trend (p_days IN NUMBER DEFAULT 30) RETURN SYS_REFCURSOR;

    -- Most frequently approved resources in [p_from, p_to).
    FUNCTION top_resources (p_from IN DATE, p_to IN DATE, p_limit IN NUMBER DEFAULT 5)
        RETURN SYS_REFCURSOR;

    -- Usage by requester department in [p_from, p_to).
    FUNCTION department_usage (p_from IN DATE, p_to IN DATE) RETURN SYS_REFCURSOR;

    -- Utilisation % of every resource in [p_from, p_to) (calls FN_RESOURCE_UTILISATION).
    FUNCTION resource_utilisation (p_from IN DATE, p_to IN DATE) RETURN SYS_REFCURSOR;

    -- Day-of-week x hour heat-map of approved bookings.
    FUNCTION peak_hours (p_from IN DATE, p_to IN DATE) RETURN SYS_REFCURSOR;

    -- CURSOR-BASED REPORT: computes utilisation per resource with a parameterised
    -- cursor and MERGEs one row per resource into UTILISATION_SNAPSHOTS.
    PROCEDURE build_utilisation_snapshot (
        p_from   IN  DATE,
        p_to     IN  DATE,
        o_rows   OUT NUMBER
    );

    -- CURSOR FOR LOOP (with FOR UPDATE / WHERE CURRENT OF): raises the priority of
    -- maintenance tickets left OPEN longer than p_days and alerts administrators.
    PROCEDURE escalate_stale_maintenance (
        p_days      IN  NUMBER DEFAULT 7,
        o_escalated OUT NUMBER
    );

    -- CURSOR FOR LOOP printing a formatted text report via DBMS_OUTPUT (SQL*Plus demo).
    PROCEDURE print_utilisation_report (p_from IN DATE, p_to IN DATE);
END pkg_resource_analytics;
/
