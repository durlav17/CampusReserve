import { withConnection, query } from '../config/db.js';

export const listDepartments = () => withConnection(null, (c) =>
  query(c, `SELECT d.dept_id, d.dept_code, d.dept_name,
                   (SELECT COUNT(*) FROM users u WHERE u.dept_id = d.dept_id) AS user_count,
                   (SELECT COUNT(*) FROM resources r WHERE r.managed_by_dept = d.dept_id) AS resource_count
              FROM departments d ORDER BY d.dept_code`));

export const listBuildings = () => withConnection(null, (c) =>
  query(c, `SELECT b.building_id, b.building_code, b.building_name, b.campus_zone, b.floors,
                   COUNT(r.resource_id) AS resource_count
              FROM buildings b LEFT JOIN resources r ON r.building_id = b.building_id
             GROUP BY b.building_id, b.building_code, b.building_name, b.campus_zone, b.floors
             ORDER BY b.building_code`));

export const listCategories = () => withConnection(null, (c) =>
  query(c, `SELECT category_id, category_code, category_name, requires_approval,
                   max_booking_hours, min_notice_hours
              FROM resource_categories ORDER BY category_name`));

export const listRoles = () => withConnection(null, (c) =>
  query(c, 'SELECT role_id, role_code, role_name, can_approve, can_administer FROM roles ORDER BY role_id'));
