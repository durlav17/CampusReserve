--------------------------------------------------------------------------------
-- CampusReserve | 03_seed_data.sql
-- PURPOSE : Insert SYNTHETIC demonstration data.
--
--   *** ALL PEOPLE, E-MAILS, PHONE NUMBERS, BOOKINGS AND MAINTENANCE TICKETS   ***
--   *** BELOW ARE SYNTHETIC. They are generated for demonstration only and do ***
--   *** not describe real persons or real reservations. Building names follow ***
--   *** common campus naming but rooms, capacities and hours are invented.   ***
--
-- Dates are relative to SYSDATE so the demo data is always "current": history
-- covers the previous 60 days and upcoming bookings cover the next 14 days.
--
-- Demo password for EVERY seeded account: Campus@2026  (bcrypt cost 10).
-- Change or disable these accounts before any real deployment.
--------------------------------------------------------------------------------
SET DEFINE OFF
SET SERVEROUTPUT ON

-- ROLES (fixed IDs: referenced by application code) ---------------------------
INSERT INTO roles (role_id, role_code, role_name, can_approve, can_administer)
VALUES (1, 'STUDENT', 'Student', 'N', 'N');
INSERT INTO roles (role_id, role_code, role_name, can_approve, can_administer)
VALUES (2, 'FACULTY', 'Faculty Member', 'N', 'N');
INSERT INTO roles (role_id, role_code, role_name, can_approve, can_administer)
VALUES (3, 'COORDINATOR', 'Resource Coordinator', 'Y', 'N');
INSERT INTO roles (role_id, role_code, role_name, can_approve, can_administer)
VALUES (4, 'ADMIN', 'System Administrator', 'Y', 'Y');

-- DEPARTMENTS ------------------------------------------------------------------
INSERT INTO departments (dept_code, dept_name) VALUES ('SCOPE',  'School of Computer Science and Engineering');
INSERT INTO departments (dept_code, dept_name) VALUES ('SENSE',  'School of Electronics Engineering');
INSERT INTO departments (dept_code, dept_name) VALUES ('SELECT', 'School of Electrical Engineering');
INSERT INTO departments (dept_code, dept_name) VALUES ('SMEC',   'School of Mechanical Engineering');
INSERT INTO departments (dept_code, dept_name) VALUES ('SAS',    'School of Advanced Sciences');
INSERT INTO departments (dept_code, dept_name) VALUES ('VITBS',  'Business School');
INSERT INTO departments (dept_code, dept_name) VALUES ('ESTATE', 'Estate and Facilities Office');

-- BUILDINGS --------------------------------------------------------------------
INSERT INTO buildings (building_code, building_name, campus_zone, floors) VALUES ('SJT',  'Silver Jubilee Tower',     'North', 9);
INSERT INTO buildings (building_code, building_name, campus_zone, floors) VALUES ('TT',   'Technology Tower',         'North', 8);
INSERT INTO buildings (building_code, building_name, campus_zone, floors) VALUES ('PRP',  'Pearl Research Park',      'East',  6);
INSERT INTO buildings (building_code, building_name, campus_zone, floors) VALUES ('MGB',  'Mahatma Gandhi Block',     'South', 4);
INSERT INTO buildings (building_code, building_name, campus_zone, floors) VALUES ('SMV',  'SMV Block',                'South', 5);
INSERT INTO buildings (building_code, building_name, campus_zone, floors) VALUES ('ANNA', 'Anna Auditorium Complex',  'Central', 2);

-- RESOURCE_CATEGORIES ----------------------------------------------------------
INSERT INTO resource_categories (category_code, category_name, requires_approval, max_booking_hours, min_notice_hours)
VALUES ('COMP_LAB',     'Computer Laboratory', 'Y', 4, 2);
INSERT INTO resource_categories (category_code, category_name, requires_approval, max_booking_hours, min_notice_hours)
VALUES ('RESEARCH_LAB', 'Research Laboratory', 'Y', 6, 12);
INSERT INTO resource_categories (category_code, category_name, requires_approval, max_booking_hours, min_notice_hours)
VALUES ('SEMINAR_HALL', 'Seminar Hall',        'Y', 6, 24);
INSERT INTO resource_categories (category_code, category_name, requires_approval, max_booking_hours, min_notice_hours)
VALUES ('AUDITORIUM',   'Auditorium',          'Y', 8, 48);
INSERT INTO resource_categories (category_code, category_name, requires_approval, max_booking_hours, min_notice_hours)
VALUES ('CLASSROOM',    'Classroom',           'N', 3, 0);
INSERT INTO resource_categories (category_code, category_name, requires_approval, max_booking_hours, min_notice_hours)
VALUES ('EQUIPMENT',    'Portable Equipment',  'N', 8, 0);

-- USERS (synthetic) -------------------------------------------------------------
-- password_hash = bcrypt('Campus@2026', 10)
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 4, d.dept_id, 'Asha Raman', 'admin@campusreserve.example', 'EMP-ADM-01', '9000000001',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'ESTATE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 3, d.dept_id, 'Vikram Iyer', 'coord.scope@campusreserve.example', 'EMP-CO-11', '9000000011',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SCOPE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 3, d.dept_id, 'Meera Pillai', 'coord.estate@campusreserve.example', 'EMP-CO-12', '9000000012',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'ESTATE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 2, d.dept_id, 'Dr. Kiran Menon', 'kiran.menon@campusreserve.example', 'EMP-FA-21', '9000000021',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SCOPE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 2, d.dept_id, 'Dr. Farah Siddiqui', 'farah.s@campusreserve.example', 'EMP-FA-22', '9000000022',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SENSE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 2, d.dept_id, 'Dr. Arjun Bose', 'arjun.bose@campusreserve.example', 'EMP-FA-23', '9000000023',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SMEC';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 1, d.dept_id, 'Rohan Gupta', 'rohan.g@campusreserve.example', '24DEMO0001', '9000000101',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SCOPE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 1, d.dept_id, 'Sneha Kulkarni', 'sneha.k@campusreserve.example', '24DEMO0002', '9000000102',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SCOPE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 1, d.dept_id, 'Aditya Rao', 'aditya.r@campusreserve.example', '24DEMO0003', '9000000103',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SENSE';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 1, d.dept_id, 'Nisha Thomas', 'nisha.t@campusreserve.example', '24DEMO0004', '9000000104',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SELECT';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 1, d.dept_id, 'Karthik Subramanian', 'karthik.s@campusreserve.example', '24DEMO0005', '9000000105',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'SMEC';
INSERT INTO users (role_id, dept_id, full_name, email, reg_no, phone, password_hash)
SELECT 1, d.dept_id, 'Priya Nair', 'priya.n@campusreserve.example', '24DEMO0006', '9000000106',
       '$2a$10$3JMXV7Ti/I.FjQXGNQIfXO6SsDygo7xpwCcmvLJqjEL.ZQo3.nqtu'
FROM departments d WHERE d.dept_code = 'VITBS';

-- RESOURCES ---------------------------------------------------------------------
-- Helper: one INSERT ... SELECT per row resolves codes to surrogate keys.
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'SJT-LAB-516', 'Data Systems Lab', c.category_id, b.building_id, d.dept_id, 5, '516', 60, 8, 20,
       'Oracle and PostgreSQL workstations for database courses.',
       '{"workstations":60,"projector":true,"software":["Oracle 19c","SQL Developer"]}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='COMP_LAB' AND b.building_code='SJT' AND d.dept_code='SCOPE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'SJT-LAB-318', 'Networks Lab', c.category_id, b.building_id, d.dept_id, 3, '318', 40, 8, 20,
       'Cisco routers, switches and packet-capture stations.',
       '{"workstations":40,"projector":true,"racks":4}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='COMP_LAB' AND b.building_code='SJT' AND d.dept_code='SCOPE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'TT-LAB-412', 'Embedded Systems Lab', c.category_id, b.building_id, d.dept_id, 4, '412', 36, 8, 19,
       'Microcontroller kits and oscilloscopes.',
       '{"workstations":36,"oscilloscopes":12}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='COMP_LAB' AND b.building_code='TT' AND d.dept_code='SENSE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'TT-LAB-214', 'Power Electronics Lab', c.category_id, b.building_id, d.dept_id, 2, '214', 30, 9, 18,
       'High-voltage benches; safety induction required.',
       '{"benches":15,"safety_induction":true}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='COMP_LAB' AND b.building_code='TT' AND d.dept_code='SELECT';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'PRP-RL-201', 'GPU Research Lab', c.category_id, b.building_id, d.dept_id, 2, '201', 12, 8, 22,
       'Shared GPU workstations for research groups.',
       '{"gpus":8,"workstations":12}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='RESEARCH_LAB' AND b.building_code='PRP' AND d.dept_code='SCOPE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'PRP-RL-305', 'Materials Testing Lab', c.category_id, b.building_id, d.dept_id, 3, '305', 10, 9, 18,
       'Universal testing machine and hardness testers.',
       '{"utm":true,"hardness_testers":2}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='RESEARCH_LAB' AND b.building_code='PRP' AND d.dept_code='SMEC';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'SJT-SH-801', 'SJT Seminar Hall 801', c.category_id, b.building_id, d.dept_id, 8, '801', 120, 8, 20,
       'Tiered seating, dual projectors, lecture capture.',
       '{"seats":120,"projectors":2,"lecture_capture":true}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='SEMINAR_HALL' AND b.building_code='SJT' AND d.dept_code='ESTATE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'TT-SH-701', 'TT Seminar Hall 701', c.category_id, b.building_id, d.dept_id, 7, '701', 90, 8, 20,
       'Flat-floor hall suitable for workshops.',
       '{"seats":90,"projectors":1,"movable_tables":true}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='SEMINAR_HALL' AND b.building_code='TT' AND d.dept_code='ESTATE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'MGB-SH-G01', 'MGB Conference Room', c.category_id, b.building_id, d.dept_id, 1, 'G01', 40, 9, 18,
       'Board-room layout with video conferencing.',
       '{"seats":40,"video_conference":true}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='SEMINAR_HALL' AND b.building_code='MGB' AND d.dept_code='VITBS';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'ANNA-AUD-1', 'Anna Main Auditorium', c.category_id, b.building_id, d.dept_id, 1, 'MAIN', 1200, 8, 22,
       'Main auditorium for convocations and cultural events.',
       '{"seats":1200,"stage":true,"sound_system":"line-array"}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='AUDITORIUM' AND b.building_code='ANNA' AND d.dept_code='ESTATE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'ANNA-AUD-2', 'Anna Mini Auditorium', c.category_id, b.building_id, d.dept_id, 2, 'MINI', 300, 8, 22,
       'Smaller auditorium for guest lectures.',
       '{"seats":300,"stage":true}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='AUDITORIUM' AND b.building_code='ANNA' AND d.dept_code='ESTATE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'SJT-CR-302', 'SJT Classroom 302', c.category_id, b.building_id, d.dept_id, 3, '302', 70, 8, 20,
       'Smart classroom.', '{"seats":70,"smart_board":true}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='CLASSROOM' AND b.building_code='SJT' AND d.dept_code='SCOPE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'SJT-CR-305', 'SJT Classroom 305', c.category_id, b.building_id, d.dept_id, 3, '305', 70, 8, 20,
       'Smart classroom.', '{"seats":70,"smart_board":true}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='CLASSROOM' AND b.building_code='SJT' AND d.dept_code='SCOPE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'TT-CR-504', 'TT Classroom 504', c.category_id, b.building_id, d.dept_id, 5, '504', 60, 8, 20,
       'Standard classroom.', '{"seats":60}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='CLASSROOM' AND b.building_code='TT' AND d.dept_code='SENSE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'SMV-CR-110', 'SMV Classroom 110', c.category_id, b.building_id, d.dept_id, 1, '110', 80, 8, 20,
       'Large classroom near the library.', '{"seats":80}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='CLASSROOM' AND b.building_code='SMV' AND d.dept_code='SAS';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'EQ-PROJ-01', 'Portable Projector Kit 01', c.category_id, NULL, d.dept_id, NULL, NULL, 0, 8, 20,
       'Projector, HDMI/USB-C adapters and screen.', '{"lumens":4000,"adapters":["HDMI","USB-C"]}'
FROM resource_categories c, departments d
WHERE c.category_code='EQUIPMENT' AND d.dept_code='ESTATE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'EQ-PROJ-02', 'Portable Projector Kit 02', c.category_id, NULL, d.dept_id, NULL, NULL, 0, 8, 20,
       'Projector, HDMI adapter and screen.', '{"lumens":3500,"adapters":["HDMI"]}'
FROM resource_categories c, departments d
WHERE c.category_code='EQUIPMENT' AND d.dept_code='ESTATE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'EQ-CAM-01', 'Event Camera Kit', c.category_id, NULL, d.dept_id, NULL, NULL, 0, 8, 22,
       'Mirrorless camera, tripod and wireless microphones.', '{"camera":"mirrorless","tripod":true,"mics":2}'
FROM resource_categories c, departments d
WHERE c.category_code='EQUIPMENT' AND d.dept_code='ESTATE';
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'EQ-PA-01', 'Portable PA System', c.category_id, NULL, d.dept_id, NULL, NULL, 0, 8, 22,
       'Two speakers, mixer and two microphones.', '{"speakers":2,"mixer":true}'
FROM resource_categories c, departments d
WHERE c.category_code='EQUIPMENT' AND d.dept_code='ESTATE';
-- One resource starts under maintenance to demonstrate business rule 4.
INSERT INTO resources (resource_code, resource_name, category_id, building_id, managed_by_dept, floor_no, room_no, capacity, status, opens_at_hour, closes_at_hour, description, features_json)
SELECT 'SMV-LAB-220', 'Physics Computing Lab', c.category_id, b.building_id, d.dept_id, 2, '220', 30, 'MAINTENANCE', 8, 18,
       'Temporarily closed: air-conditioning repair.', '{"workstations":30}'
FROM resource_categories c, buildings b, departments d
WHERE c.category_code='COMP_LAB' AND b.building_code='SMV' AND d.dept_code='SAS';

--------------------------------------------------------------------------------
-- BOOKINGS - deterministic synthetic generator
-- * 60 days of history and 14 days ahead, Sundays skipped.
-- * Four 2-hour slots per day (09, 11, 14, 16) so seeded bookings never overlap.
-- * A slot is booked when MOD(hash, 5) < 2  (roughly 40 % of slots).
--------------------------------------------------------------------------------
DECLARE
    TYPE t_num IS TABLE OF NUMBER;
    v_slots       t_num := t_num(9, 11, 14, 16);
    v_requesters  t_num;
    v_approver    users.user_id%TYPE;
    v_day         DATE;
    v_hash        PLS_INTEGER;
    v_status      bookings.status%TYPE;
    v_start       TIMESTAMP;
    v_id          bookings.booking_id%TYPE;
    v_attendees   PLS_INTEGER;
    v_user        users.user_id%TYPE;
    v_count       PLS_INTEGER := 0;
    v_titles      SYS.ODCIVARCHAR2LIST := SYS.ODCIVARCHAR2LIST(
                      'Lab session', 'Project review', 'Club meeting', 'Workshop',
                      'Guest lecture', 'Tutorial', 'Research group sync', 'Practice session');
BEGIN
    SELECT user_id BULK COLLECT INTO v_requesters
    FROM users WHERE role_id IN (1, 2) ORDER BY user_id;
    FOR r IN (SELECT r.resource_id, r.capacity, r.status, r.opens_at_hour, r.closes_at_hour,
                     r.managed_by_dept, c.requires_approval
              FROM resources r JOIN resource_categories c ON c.category_id = r.category_id
              ORDER BY r.resource_id)
    LOOP
        -- Approver = coordinator of the managing department, otherwise the admin
        -- (the same authorisation rule SP_DECIDE_BOOKING enforces).
        SELECT NVL(MIN(CASE WHEN role_id = 3 AND dept_id = r.managed_by_dept THEN user_id END),
                   MIN(CASE WHEN role_id = 4 THEN user_id END))
          INTO v_approver
          FROM users;
        FOR d IN -60 .. 14 LOOP
            v_day := TRUNC(SYSDATE) + d;
            CONTINUE WHEN v_day - TRUNC(v_day, 'IW') = 6;                          -- Sunday (ISO week, NLS-independent)
            CONTINUE WHEN d >= 0 AND r.status <> 'AVAILABLE';                        -- no future use of closed resources
            FOR k IN 1 .. v_slots.COUNT LOOP
                CONTINUE WHEN v_slots(k) < r.opens_at_hour OR v_slots(k) + 2 > r.closes_at_hour;
                v_hash := MOD(r.resource_id * 31 + (d + 100) * 7 + k * 13, 97);
                CONTINUE WHEN MOD(v_hash, 5) >= 2;

                v_start := CAST(v_day AS TIMESTAMP) + NUMTODSINTERVAL(v_slots(k), 'HOUR');
                v_user  := v_requesters(MOD(v_hash, v_requesters.COUNT) + 1);
                v_attendees := CASE WHEN r.capacity = 0 THEN 1
                                    ELSE LEAST(r.capacity, 5 + MOD(v_hash * 3, 40)) END;
                IF d < 0 THEN
                    v_status := CASE MOD(v_hash, 11) WHEN 0 THEN 'CANCELLED'
                                                     WHEN 1 THEN 'REJECTED'
                                                     ELSE 'APPROVED' END;
                ELSE
                    v_status := CASE WHEN r.requires_approval = 'Y' AND MOD(v_hash, 3) = 0
                                     THEN 'PENDING' ELSE 'APPROVED' END;
                END IF;
                IF r.requires_approval = 'N' AND v_status = 'REJECTED' THEN
                    v_status := 'APPROVED';
                END IF;

                INSERT INTO bookings (resource_id, requested_by, title, purpose, attendees,
                                      start_time, end_time, status, created_at, updated_at,
                                      cancelled_at, cancel_reason)
                VALUES (r.resource_id, v_user,
                        v_titles(MOD(v_hash, v_titles.COUNT) + 1),
                        'Synthetic demonstration booking',
                        v_attendees, v_start, v_start + NUMTODSINTERVAL(2, 'HOUR'), v_status,
                        v_start - NUMTODSINTERVAL(3 + MOD(v_hash, 5), 'DAY'),
                        v_start - NUMTODSINTERVAL(2, 'DAY'),
                        CASE WHEN v_status = 'CANCELLED' THEN v_start - NUMTODSINTERVAL(1, 'DAY') END,
                        CASE WHEN v_status = 'CANCELLED' THEN 'Plans changed (synthetic)' END)
                RETURNING booking_id INTO v_id;

                IF r.requires_approval = 'Y' AND v_status IN ('APPROVED','REJECTED') THEN
                    INSERT INTO booking_approvals (booking_id, approver_id, decision, remarks, decided_at)
                    VALUES (v_id, v_approver, v_status,
                            CASE v_status WHEN 'REJECTED' THEN 'Slot reserved for timetabled class'
                                          ELSE 'Approved' END,
                            v_start - NUMTODSINTERVAL(2, 'DAY'));
                END IF;
                v_count := v_count + 1;
            END LOOP;
        END LOOP;
    END LOOP;
    DBMS_OUTPUT.PUT_LINE('Synthetic bookings inserted: ' || v_count);
END;
/

-- MAINTENANCE_REQUESTS ----------------------------------------------------------
INSERT INTO maintenance_requests (resource_id, reported_by, assigned_to, title, description, priority, status, blocks_booking, created_at, updated_at)
SELECT r.resource_id, (SELECT user_id FROM users WHERE email='kiran.menon@campusreserve.example'),
       (SELECT user_id FROM users WHERE email='coord.estate@campusreserve.example'),
       'Air-conditioning failure', 'Room temperature above 32 C; unsafe for workstations.',
       'HIGH', 'IN_PROGRESS', 'Y', SYSTIMESTAMP - INTERVAL '3' DAY, SYSTIMESTAMP - INTERVAL '1' DAY
FROM resources r WHERE r.resource_code = 'SMV-LAB-220';
INSERT INTO maintenance_requests (resource_id, reported_by, title, description, priority, status, blocks_booking, created_at, updated_at)
SELECT r.resource_id, (SELECT user_id FROM users WHERE email='rohan.g@campusreserve.example'),
       'Projector colour cast', 'Left projector shows a green tint.', 'LOW', 'OPEN', 'N',
       SYSTIMESTAMP - INTERVAL '9' DAY, SYSTIMESTAMP - INTERVAL '9' DAY
FROM resources r WHERE r.resource_code = 'SJT-SH-801';
INSERT INTO maintenance_requests (resource_id, reported_by, title, description, priority, status, blocks_booking, created_at, updated_at)
SELECT r.resource_id, (SELECT user_id FROM users WHERE email='farah.s@campusreserve.example'),
       'Two oscilloscopes not powering on', 'Benches 4 and 7.', 'MEDIUM', 'OPEN', 'N',
       SYSTIMESTAMP - INTERVAL '2' DAY, SYSTIMESTAMP - INTERVAL '2' DAY
FROM resources r WHERE r.resource_code = 'TT-LAB-412';
INSERT INTO maintenance_requests (resource_id, reported_by, assigned_to, title, description, priority, status, blocks_booking, created_at, updated_at, resolved_at, resolution_notes)
SELECT r.resource_id, (SELECT user_id FROM users WHERE email='sneha.k@campusreserve.example'),
       (SELECT user_id FROM users WHERE email='coord.estate@campusreserve.example'),
       'Network switch port failure', 'Rows C and D offline.', 'HIGH', 'RESOLVED', 'N',
       SYSTIMESTAMP - INTERVAL '20' DAY, SYSTIMESTAMP - INTERVAL '18' DAY,
       SYSTIMESTAMP - INTERVAL '18' DAY, 'Switch replaced.'
FROM resources r WHERE r.resource_code = 'SJT-LAB-318';

-- RESOURCE_BLACKOUTS: next ISO week's Sunday (no seeded bookings on Sundays) -----
INSERT INTO resource_blackouts (resource_id, start_time, end_time, blackout_type, reason, created_by)
SELECT r.resource_id,
       CAST(TRUNC(SYSDATE, 'IW') + 13 AS TIMESTAMP) + INTERVAL '8' HOUR,
       CAST(TRUNC(SYSDATE, 'IW') + 13 AS TIMESTAMP) + INTERVAL '20' HOUR,
       'EXAM', 'Entrance examination centre (synthetic)',
       (SELECT user_id FROM users WHERE email='admin@campusreserve.example')
FROM resources r WHERE r.resource_code IN ('SJT-CR-302', 'SJT-CR-305');

-- NOTIFICATIONS -------------------------------------------------------------------
INSERT INTO notifications (user_id, notif_type, title, message)
SELECT user_id, 'SYSTEM', 'Welcome to CampusReserve',
       'This is a demonstration environment populated with synthetic data.'
FROM users;

COMMIT;
