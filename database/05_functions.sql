--------------------------------------------------------------------------------
-- CampusReserve | 05_functions.sql
-- PURPOSE : Stand-alone PL/SQL functions.
--   FN_CURRENT_ACTOR          - application user ID from CLIENT_IDENTIFIER (helper)
--   FN_HOURS_BETWEEN          - exact hours between two timestamps (helper)
--   FN_BOOKING_DURATION_HOURS - duration of one booking
--   FN_RESOURCE_UTILISATION   - % of operating hours booked in a date window
--   FN_RESOURCE_AVAILABILITY  - availability verdict for a proposed interval
-- None of these functions modify data, so they are callable from SQL.
--------------------------------------------------------------------------------
SET DEFINE OFF

-- Helper: ID of the application user making the current call. The API sets the
-- session CLIENT_IDENTIFIER to that ID; NULL when unset or not numeric.
CREATE OR REPLACE FUNCTION fn_current_actor RETURN NUMBER
IS
BEGIN
    RETURN TO_NUMBER(SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER'));
EXCEPTION
    WHEN VALUE_ERROR OR INVALID_NUMBER THEN
        RETURN NULL;
END fn_current_actor;
/

-- Helper: TIMESTAMP - TIMESTAMP yields INTERVAL DAY TO SECOND; convert to hours.
CREATE OR REPLACE FUNCTION fn_hours_between (
    p_start IN TIMESTAMP,
    p_end   IN TIMESTAMP
) RETURN NUMBER
DETERMINISTIC
IS
    v_diff INTERVAL DAY(9) TO SECOND(6);
BEGIN
    IF p_start IS NULL OR p_end IS NULL THEN
        RETURN NULL;
    END IF;
    v_diff := p_end - p_start;
    RETURN EXTRACT(DAY    FROM v_diff) * 24
         + EXTRACT(HOUR   FROM v_diff)
         + EXTRACT(MINUTE FROM v_diff) / 60
         + EXTRACT(SECOND FROM v_diff) / 3600;
END fn_hours_between;
/

-- A. Booking duration ---------------------------------------------------------
-- IN  p_booking_id : booking to measure
-- OUT (return)     : duration in hours, rounded to 2 dp; raises -20010 if missing
CREATE OR REPLACE FUNCTION fn_booking_duration_hours (
    p_booking_id IN bookings.booking_id%TYPE
) RETURN NUMBER
IS
    v_start bookings.start_time%TYPE;
    v_end   bookings.end_time%TYPE;
BEGIN
    SELECT start_time, end_time
      INTO v_start, v_end
      FROM bookings
     WHERE booking_id = p_booking_id;
    RETURN ROUND(fn_hours_between(v_start, v_end), 2);
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20010, 'Booking ' || p_booking_id || ' does not exist.');
END fn_booking_duration_hours;
/

-- B. Resource utilisation -------------------------------------------------------
-- Utilisation = approved hours inside [p_from, p_to) / operating hours in window.
-- Bookings that straddle the window edge are clipped with GREATEST / LEAST.
-- IN  p_resource_id, p_from (inclusive DATE), p_to (exclusive DATE)
-- OUT (return) percentage 0-100, 2 dp
CREATE OR REPLACE FUNCTION fn_resource_utilisation (
    p_resource_id IN resources.resource_id%TYPE,
    p_from        IN DATE,
    p_to          IN DATE
) RETURN NUMBER
IS
    v_open        resources.opens_at_hour%TYPE;
    v_close       resources.closes_at_hour%TYPE;
    v_booked      NUMBER;
    v_available   NUMBER;
    v_from_ts     TIMESTAMP := CAST(TRUNC(p_from) AS TIMESTAMP);
    v_to_ts       TIMESTAMP := CAST(TRUNC(p_to)   AS TIMESTAMP);
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR TRUNC(p_to) <= TRUNC(p_from) THEN
        RAISE_APPLICATION_ERROR(-20001, 'Utilisation window must have p_to after p_from.');
    END IF;

    SELECT opens_at_hour, closes_at_hour
      INTO v_open, v_close
      FROM resources
     WHERE resource_id = p_resource_id;

    SELECT NVL(SUM(fn_hours_between(GREATEST(start_time, v_from_ts),
                                    LEAST(end_time, v_to_ts))), 0)
      INTO v_booked
      FROM bookings
     WHERE resource_id = p_resource_id
       AND status      = 'APPROVED'
       AND start_time  < v_to_ts
       AND end_time    > v_from_ts;

    v_available := (TRUNC(p_to) - TRUNC(p_from)) * (v_close - v_open);
    RETURN LEAST(100, ROUND(100 * v_booked / v_available, 2));
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20002, 'Resource ' || p_resource_id || ' does not exist.');
END fn_resource_utilisation;
/

-- C. Availability verdict -------------------------------------------------------
-- Returns one of: AVAILABLE, INVALID_INTERVAL, NOT_FOUND, MAINTENANCE, RETIRED,
-- OUTSIDE_HOURS, BLACKOUT, CONFLICT.
-- p_ignore_booking lets an existing booking be re-checked without clashing with itself.
-- NOTE: this is an advisory read (no lock). Final acceptance is decided inside
-- SP_CREATE_BOOKING while holding the resource row lock - see 06_procedures.sql.
CREATE OR REPLACE FUNCTION fn_resource_availability (
    p_resource_id    IN resources.resource_id%TYPE,
    p_start          IN TIMESTAMP,
    p_end            IN TIMESTAMP,
    p_ignore_booking IN bookings.booking_id%TYPE DEFAULT NULL
) RETURN VARCHAR2
IS
    v_status  resources.status%TYPE;
    v_open    resources.opens_at_hour%TYPE;
    v_close   resources.closes_at_hour%TYPE;
    v_count   PLS_INTEGER;
BEGIN
    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RETURN 'INVALID_INTERVAL';
    END IF;

    BEGIN
        SELECT status, opens_at_hour, closes_at_hour
          INTO v_status, v_open, v_close
          FROM resources
         WHERE resource_id = p_resource_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN RETURN 'NOT_FOUND';
    END;

    IF v_status = 'MAINTENANCE' THEN RETURN 'MAINTENANCE'; END IF;
    IF v_status = 'RETIRED'     THEN RETURN 'RETIRED';     END IF;

    -- Must start and end on the same day, inside operating hours.
    IF TRUNC(CAST(p_start AS DATE)) <> TRUNC(CAST(p_end - NUMTODSINTERVAL(1, 'SECOND') AS DATE))
       OR p_start < CAST(TRUNC(CAST(p_start AS DATE)) AS TIMESTAMP) + NUMTODSINTERVAL(v_open, 'HOUR')
       OR p_end   > CAST(TRUNC(CAST(p_start AS DATE)) AS TIMESTAMP) + NUMTODSINTERVAL(v_close, 'HOUR')
    THEN
        RETURN 'OUTSIDE_HOURS';
    END IF;

    SELECT COUNT(*) INTO v_count
      FROM resource_blackouts
     WHERE resource_id = p_resource_id
       AND start_time < p_end AND end_time > p_start;
    IF v_count > 0 THEN RETURN 'BLACKOUT'; END IF;

    -- Two half-open intervals [s1,e1) and [s2,e2) overlap  <=>  s1 < e2 AND s2 < e1
    SELECT COUNT(*) INTO v_count
      FROM bookings
     WHERE resource_id = p_resource_id
       AND status IN ('PENDING', 'APPROVED')
       AND start_time < p_end
       AND end_time   > p_start
       AND (p_ignore_booking IS NULL OR booking_id <> p_ignore_booking);
    IF v_count > 0 THEN RETURN 'CONFLICT'; END IF;

    RETURN 'AVAILABLE';
END fn_resource_availability;
/
