--------------------------------------------------------------------------------
-- CampusReserve | 02_constraints_indexes.sql
-- PURPOSE : Named UNIQUE, CHECK and FOREIGN KEY constraints, then indexes.
--           Naming convention: uq_ / ck_ / fk_ / ix_ + table + column(s).
--------------------------------------------------------------------------------
SET DEFINE OFF

-- ROLES ------------------------------------------------------------------------
ALTER TABLE roles ADD CONSTRAINT uq_roles_code UNIQUE (role_code);
ALTER TABLE roles ADD CONSTRAINT ck_roles_code
    CHECK (role_code IN ('STUDENT','FACULTY','COORDINATOR','ADMIN'));
ALTER TABLE roles ADD CONSTRAINT ck_roles_can_approve CHECK (can_approve IN ('Y','N'));
ALTER TABLE roles ADD CONSTRAINT ck_roles_can_admin   CHECK (can_administer IN ('Y','N'));

-- DEPARTMENTS ------------------------------------------------------------------
ALTER TABLE departments ADD CONSTRAINT uq_departments_code UNIQUE (dept_code);
ALTER TABLE departments ADD CONSTRAINT uq_departments_name UNIQUE (dept_name);

-- USERS ------------------------------------------------------------------------
ALTER TABLE users ADD CONSTRAINT uq_users_email  UNIQUE (email);
ALTER TABLE users ADD CONSTRAINT uq_users_reg_no UNIQUE (reg_no);
ALTER TABLE users ADD CONSTRAINT ck_users_email
    CHECK (REGEXP_LIKE(email, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'));
ALTER TABLE users ADD CONSTRAINT ck_users_active CHECK (is_active IN ('Y','N'));
ALTER TABLE users ADD CONSTRAINT fk_users_role
    FOREIGN KEY (role_id) REFERENCES roles (role_id);
ALTER TABLE users ADD CONSTRAINT fk_users_dept
    FOREIGN KEY (dept_id) REFERENCES departments (dept_id);

-- BUILDINGS --------------------------------------------------------------------
ALTER TABLE buildings ADD CONSTRAINT uq_buildings_code UNIQUE (building_code);
ALTER TABLE buildings ADD CONSTRAINT ck_buildings_floors CHECK (floors BETWEEN 1 AND 50);

-- RESOURCE_CATEGORIES ----------------------------------------------------------
ALTER TABLE resource_categories ADD CONSTRAINT uq_rescat_code UNIQUE (category_code);
ALTER TABLE resource_categories ADD CONSTRAINT ck_rescat_approval
    CHECK (requires_approval IN ('Y','N'));
ALTER TABLE resource_categories ADD CONSTRAINT ck_rescat_max_hours
    CHECK (max_booking_hours > 0 AND max_booking_hours <= 72);
ALTER TABLE resource_categories ADD CONSTRAINT ck_rescat_notice
    CHECK (min_notice_hours >= 0);

-- RESOURCES --------------------------------------------------------------------
ALTER TABLE resources ADD CONSTRAINT uq_resources_code UNIQUE (resource_code);
ALTER TABLE resources ADD CONSTRAINT ck_resources_status
    CHECK (status IN ('AVAILABLE','MAINTENANCE','RETIRED'));
ALTER TABLE resources ADD CONSTRAINT ck_resources_capacity CHECK (capacity >= 0);
ALTER TABLE resources ADD CONSTRAINT ck_resources_hours
    CHECK (opens_at_hour BETWEEN 0 AND 23 AND closes_at_hour BETWEEN 1 AND 24
           AND closes_at_hour > opens_at_hour);
ALTER TABLE resources ADD CONSTRAINT ck_resources_features_json
    CHECK (features_json IS JSON);
ALTER TABLE resources ADD CONSTRAINT fk_resources_category
    FOREIGN KEY (category_id) REFERENCES resource_categories (category_id);
ALTER TABLE resources ADD CONSTRAINT fk_resources_building
    FOREIGN KEY (building_id) REFERENCES buildings (building_id);
ALTER TABLE resources ADD CONSTRAINT fk_resources_dept
    FOREIGN KEY (managed_by_dept) REFERENCES departments (dept_id);

-- BOOKINGS ---------------------------------------------------------------------
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_interval CHECK (end_time > start_time);
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_status
    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_attendees CHECK (attendees >= 1);
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_cancel
    CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL)
        OR (status <> 'CANCELLED' AND cancelled_at IS NULL));
ALTER TABLE bookings ADD CONSTRAINT uq_bookings_request_key UNIQUE (request_key);
ALTER TABLE bookings ADD CONSTRAINT fk_bookings_resource
    FOREIGN KEY (resource_id) REFERENCES resources (resource_id);
ALTER TABLE bookings ADD CONSTRAINT fk_bookings_user
    FOREIGN KEY (requested_by) REFERENCES users (user_id);

-- BOOKING_APPROVALS ------------------------------------------------------------
ALTER TABLE booking_approvals ADD CONSTRAINT ck_approvals_decision
    CHECK (decision IN ('APPROVED','REJECTED'));
-- A booking is decided exactly once; re-decisions are rejected.
ALTER TABLE booking_approvals ADD CONSTRAINT uq_approvals_booking UNIQUE (booking_id);
ALTER TABLE booking_approvals ADD CONSTRAINT fk_approvals_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (booking_id) ON DELETE CASCADE;
ALTER TABLE booking_approvals ADD CONSTRAINT fk_approvals_approver
    FOREIGN KEY (approver_id) REFERENCES users (user_id);

-- MAINTENANCE_REQUESTS ---------------------------------------------------------
ALTER TABLE maintenance_requests ADD CONSTRAINT ck_maint_priority
    CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL'));
ALTER TABLE maintenance_requests ADD CONSTRAINT ck_maint_status
    CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED'));
ALTER TABLE maintenance_requests ADD CONSTRAINT ck_maint_blocks CHECK (blocks_booking IN ('Y','N'));
ALTER TABLE maintenance_requests ADD CONSTRAINT ck_maint_resolved
    CHECK ((status IN ('RESOLVED','CLOSED') AND resolved_at IS NOT NULL)
        OR (status IN ('OPEN','IN_PROGRESS') AND resolved_at IS NULL));
ALTER TABLE maintenance_requests ADD CONSTRAINT fk_maint_resource
    FOREIGN KEY (resource_id) REFERENCES resources (resource_id);
ALTER TABLE maintenance_requests ADD CONSTRAINT fk_maint_reporter
    FOREIGN KEY (reported_by) REFERENCES users (user_id);
ALTER TABLE maintenance_requests ADD CONSTRAINT fk_maint_assignee
    FOREIGN KEY (assigned_to) REFERENCES users (user_id);

-- RESOURCE_BLACKOUTS -----------------------------------------------------------
ALTER TABLE resource_blackouts ADD CONSTRAINT ck_blackouts_interval CHECK (end_time > start_time);
ALTER TABLE resource_blackouts ADD CONSTRAINT ck_blackouts_type
    CHECK (blackout_type IN ('MAINTENANCE','HOLIDAY','EXAM','EVENT'));
ALTER TABLE resource_blackouts ADD CONSTRAINT fk_blackouts_resource
    FOREIGN KEY (resource_id) REFERENCES resources (resource_id);
ALTER TABLE resource_blackouts ADD CONSTRAINT fk_blackouts_maint
    FOREIGN KEY (maintenance_id) REFERENCES maintenance_requests (request_id) ON DELETE SET NULL;
ALTER TABLE resource_blackouts ADD CONSTRAINT fk_blackouts_user
    FOREIGN KEY (created_by) REFERENCES users (user_id);

-- AUDIT_LOGS (no FK on changed_by: audit rows must survive user deletion) -----
ALTER TABLE audit_logs ADD CONSTRAINT ck_audit_action
    CHECK (action IN ('INSERT','UPDATE','DELETE'));

-- NOTIFICATIONS ----------------------------------------------------------------
ALTER TABLE notifications ADD CONSTRAINT ck_notif_read CHECK (is_read IN ('Y','N'));
ALTER TABLE notifications ADD CONSTRAINT ck_notif_type
    CHECK (notif_type IN ('BOOKING','APPROVAL','MAINTENANCE','SYSTEM'));
ALTER TABLE notifications ADD CONSTRAINT fk_notif_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notif_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (booking_id) ON DELETE SET NULL;

-- UTILISATION_SNAPSHOTS --------------------------------------------------------
ALTER TABLE utilisation_snapshots ADD CONSTRAINT ck_snap_period CHECK (period_end > period_start);
ALTER TABLE utilisation_snapshots ADD CONSTRAINT ck_snap_pct CHECK (utilisation_pct BETWEEN 0 AND 100);
ALTER TABLE utilisation_snapshots ADD CONSTRAINT uq_snap_resource_period
    UNIQUE (resource_id, period_start, period_end);
ALTER TABLE utilisation_snapshots ADD CONSTRAINT fk_snap_resource
    FOREIGN KEY (resource_id) REFERENCES resources (resource_id) ON DELETE CASCADE;

--------------------------------------------------------------------------------
-- INDEXES
-- Oracle does NOT index foreign keys automatically. Unindexed FKs cause full
-- scans on joins and table-level locks on the child when a parent key changes.
--------------------------------------------------------------------------------
-- Overlap search: WHERE resource_id = :r AND start_time < :e AND end_time > :s
CREATE INDEX ix_bookings_res_time     ON bookings (resource_id, start_time, end_time);
-- "My bookings" page and per-user history
CREATE INDEX ix_bookings_user_start   ON bookings (requested_by, start_time);
-- Approval queue and dashboards filter by status and date
CREATE INDEX ix_bookings_status_start ON bookings (status, start_time);
CREATE INDEX ix_approvals_approver    ON booking_approvals (approver_id);
CREATE INDEX ix_users_role            ON users (role_id);
CREATE INDEX ix_users_dept            ON users (dept_id);
CREATE INDEX ix_resources_category    ON resources (category_id);
CREATE INDEX ix_resources_building    ON resources (building_id);
CREATE INDEX ix_resources_dept        ON resources (managed_by_dept);
CREATE INDEX ix_resources_status      ON resources (status);
CREATE INDEX ix_maint_status_priority ON maintenance_requests (status, priority);
CREATE INDEX ix_maint_resource        ON maintenance_requests (resource_id, status);
CREATE INDEX ix_maint_reporter        ON maintenance_requests (reported_by);
CREATE INDEX ix_maint_assignee        ON maintenance_requests (assigned_to);
CREATE INDEX ix_blackouts_res_time    ON resource_blackouts (resource_id, start_time, end_time);
CREATE INDEX ix_blackouts_maint       ON resource_blackouts (maintenance_id);
CREATE INDEX ix_blackouts_user        ON resource_blackouts (created_by);
CREATE INDEX ix_audit_record          ON audit_logs (table_name, record_id);
CREATE INDEX ix_audit_changed_at      ON audit_logs (changed_at);
CREATE INDEX ix_notif_user_read       ON notifications (user_id, is_read, created_at);
CREATE INDEX ix_notif_booking         ON notifications (booking_id);
CREATE INDEX ix_snap_period           ON utilisation_snapshots (period_start, period_end);
-- Login lookup uses uq_users_email (unique index); trg_users_biu stores e-mail
-- in lower case so no function-based index is needed.
