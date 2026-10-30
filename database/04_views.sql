--------------------------------------------------------------------------------
-- CampusReserve | 04_views.sql
-- PURPOSE : Read models used by the API and by analytics. Views are pure SQL
--           (joins, subqueries, aggregates, analytic functions) so they compile
--           independently of the PL/SQL objects created later.
-- Duration arithmetic: (CAST(t2 AS DATE) - CAST(t1 AS DATE)) * 24 gives hours;
-- bookings are minute-granular, so dropping fractional seconds is harmless.
--------------------------------------------------------------------------------
SET DEFINE OFF

-- 1. Catalogue: INNER joins for mandatory parents, LEFT join for optional building
CREATE OR REPLACE VIEW v_resource_catalog AS
SELECT r.resource_id, r.resource_code, r.resource_name, r.status,
       r.capacity, r.floor_no, r.room_no, r.opens_at_hour, r.closes_at_hour,
       r.description, r.features_json,
       c.category_id, c.category_code, c.category_name, c.requires_approval,
       c.max_booking_hours, c.min_notice_hours,
       b.building_id, b.building_code, b.building_name, b.campus_zone,
       d.dept_id, d.dept_code AS managed_by_dept_code, d.dept_name AS managed_by_dept_name,
       (SELECT COUNT(*) FROM maintenance_requests m
         WHERE m.resource_id = r.resource_id
           AND m.status IN ('OPEN','IN_PROGRESS'))                       AS open_maintenance,
       CASE WHEN r.status = 'AVAILABLE' THEN 'Y' ELSE 'N' END            AS is_bookable
FROM resources r
JOIN resource_categories c ON c.category_id = r.category_id
JOIN departments d         ON d.dept_id     = r.managed_by_dept
LEFT JOIN buildings b      ON b.building_id = r.building_id;

-- 2. Booking details with requester, resource and (optional) decision
CREATE OR REPLACE VIEW v_booking_details AS
SELECT bk.booking_id, bk.title, bk.purpose, bk.attendees, bk.status,
       bk.start_time, bk.end_time, bk.created_at, bk.updated_at,
       bk.cancelled_at, bk.cancel_reason, bk.request_key,
       ROUND((CAST(bk.end_time AS DATE) - CAST(bk.start_time AS DATE)) * 24, 2) AS duration_hours,
       r.resource_id, r.resource_code, r.resource_name, r.capacity,
       c.category_code, c.category_name, c.requires_approval,
       b.building_code, b.building_name,
       u.user_id AS requester_id, u.full_name AS requester_name, u.email AS requester_email,
       ud.dept_code AS requester_dept_code, ro.role_code AS requester_role,
       ap.decision, ap.remarks AS decision_remarks, ap.decided_at,
       apu.full_name AS approver_name
FROM bookings bk
JOIN resources r            ON r.resource_id  = bk.resource_id
JOIN resource_categories c  ON c.category_id  = r.category_id
LEFT JOIN buildings b       ON b.building_id  = r.building_id
JOIN users u                ON u.user_id      = bk.requested_by
JOIN departments ud         ON ud.dept_id     = u.dept_id
JOIN roles ro               ON ro.role_id     = u.role_id
LEFT JOIN booking_approvals ap ON ap.booking_id = bk.booking_id
LEFT JOIN users apu         ON apu.user_id    = ap.approver_id;

-- 3. Approval queue (future pending requests), oldest request first
CREATE OR REPLACE VIEW v_pending_approvals AS
SELECT v.*,
       ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(v.created_at AS DATE)) * 24, 1) AS hours_waiting,
       (SELECT COUNT(*) FROM bookings o
         WHERE o.resource_id = v.resource_id
           AND o.status = 'PENDING'
           AND o.booking_id <> v.booking_id
           AND o.start_time < v.end_time AND o.end_time > v.start_time) AS competing_requests
FROM v_booking_details v
WHERE v.status = 'PENDING'
  AND v.start_time > SYSTIMESTAMP;

-- 4. Bookings in progress right now
CREATE OR REPLACE VIEW v_active_bookings AS
SELECT *
FROM v_booking_details
WHERE status = 'APPROVED'
  AND SYSTIMESTAMP BETWEEN start_time AND end_time;

-- 5. Maintenance board
CREATE OR REPLACE VIEW v_maintenance_dashboard AS
SELECT m.request_id, m.title, m.description, m.priority, m.status, m.blocks_booking,
       m.created_at, m.updated_at, m.resolved_at, m.resolution_notes,
       ROUND(CAST(NVL(m.resolved_at, SYSTIMESTAMP) AS DATE) - CAST(m.created_at AS DATE), 1) AS age_days,
       r.resource_id, r.resource_code, r.resource_name, r.status AS resource_status,
       rep.user_id AS reporter_id, rep.full_name AS reporter_name,
       asg.user_id AS assignee_id, asg.full_name AS assignee_name,
       CASE m.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
                       WHEN 'MEDIUM' THEN 3 ELSE 4 END AS priority_rank
FROM maintenance_requests m
JOIN resources r   ON r.resource_id = m.resource_id
JOIN users rep     ON rep.user_id   = m.reported_by
LEFT JOIN users asg ON asg.user_id  = m.assigned_to;

-- 6. Utilisation over the last 30 days (approved hours clipped to the window)
CREATE OR REPLACE VIEW v_resource_utilisation_30d AS
WITH win AS (
    SELECT CAST(TRUNC(SYSDATE) - 30 AS TIMESTAMP) AS w_start,
           CAST(TRUNC(SYSDATE)      AS TIMESTAMP) AS w_end
    FROM dual
), used AS (
    SELECT bk.resource_id,
           COUNT(*) AS booking_count,
           SUM((CAST(LEAST(bk.end_time, w.w_end) AS DATE)
              - CAST(GREATEST(bk.start_time, w.w_start) AS DATE)) * 24) AS booked_hours
    FROM bookings bk CROSS JOIN win w
    WHERE bk.status = 'APPROVED'
      AND bk.start_time < w.w_end
      AND bk.end_time   > w.w_start
    GROUP BY bk.resource_id
)
SELECT r.resource_id, r.resource_code, r.resource_name, c.category_code,
       NVL(u.booking_count, 0)                         AS booking_count,
       ROUND(NVL(u.booked_hours, 0), 2)                AS booked_hours,
       30 * (r.closes_at_hour - r.opens_at_hour)       AS available_hours,
       ROUND(100 * NVL(u.booked_hours, 0)
             / (30 * (r.closes_at_hour - r.opens_at_hour)), 2) AS utilisation_pct
FROM resources r
JOIN resource_categories c ON c.category_id = r.category_id
LEFT JOIN used u ON u.resource_id = r.resource_id
WHERE r.status <> 'RETIRED';

-- 7. Department-wise usage (GROUP BY + HAVING)
CREATE OR REPLACE VIEW v_department_usage AS
SELECT d.dept_id, d.dept_code, d.dept_name,
       COUNT(bk.booking_id)                                         AS total_requests,
       SUM(CASE WHEN bk.status = 'APPROVED'  THEN 1 ELSE 0 END)     AS approved,
       SUM(CASE WHEN bk.status = 'REJECTED'  THEN 1 ELSE 0 END)     AS rejected,
       SUM(CASE WHEN bk.status = 'CANCELLED' THEN 1 ELSE 0 END)     AS cancelled,
       ROUND(SUM(CASE WHEN bk.status = 'APPROVED'
                      THEN (CAST(bk.end_time AS DATE) - CAST(bk.start_time AS DATE)) * 24
                      ELSE 0 END), 1)                               AS approved_hours,
       COUNT(DISTINCT bk.resource_id)                               AS distinct_resources
FROM departments d
JOIN users u     ON u.dept_id = d.dept_id
JOIN bookings bk ON bk.requested_by = u.user_id
GROUP BY d.dept_id, d.dept_code, d.dept_name
HAVING COUNT(bk.booking_id) > 0;

-- 8. Daily booking trend (conditional aggregation, last 60 days + next 14)
CREATE OR REPLACE VIEW v_booking_trend_daily AS
SELECT TRUNC(CAST(start_time AS DATE))                         AS booking_day,
       COUNT(*)                                                AS total,
       SUM(CASE WHEN status = 'APPROVED'  THEN 1 ELSE 0 END)   AS approved,
       SUM(CASE WHEN status = 'PENDING'   THEN 1 ELSE 0 END)   AS pending,
       SUM(CASE WHEN status = 'REJECTED'  THEN 1 ELSE 0 END)   AS rejected,
       SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END)   AS cancelled
FROM bookings
WHERE start_time >= CAST(TRUNC(SYSDATE) - 60 AS TIMESTAMP)
  AND start_time <  CAST(TRUNC(SYSDATE) + 15 AS TIMESTAMP)
GROUP BY TRUNC(CAST(start_time AS DATE));

-- 9. Most-booked resources over 90 days (analytic ranking)
CREATE OR REPLACE VIEW v_top_resources AS
SELECT resource_id, resource_code, resource_name, category_code,
       approved_count, approved_hours,
       DENSE_RANK() OVER (ORDER BY approved_count DESC, approved_hours DESC) AS popularity_rank
FROM (
    SELECT r.resource_id, r.resource_code, r.resource_name, c.category_code,
           COUNT(bk.booking_id) AS approved_count,
           ROUND(NVL(SUM((CAST(bk.end_time AS DATE) - CAST(bk.start_time AS DATE)) * 24), 0), 1) AS approved_hours
    FROM resources r
    JOIN resource_categories c ON c.category_id = r.category_id
    LEFT JOIN bookings bk
           ON bk.resource_id = r.resource_id
          AND bk.status = 'APPROVED'
          AND bk.start_time >= CAST(TRUNC(SYSDATE) - 90 AS TIMESTAMP)
    GROUP BY r.resource_id, r.resource_code, r.resource_name, c.category_code
);
