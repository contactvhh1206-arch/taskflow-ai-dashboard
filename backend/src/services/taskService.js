const pool = require('../config/database');

const getTasksList = async ({ userId, role, facilityId, departmentCode, status, limit, offset }) => {
    let baseWhere = `1=1`;
    const params = [];

    // Filter theo Cơ sở (Do rbacGuard truyền xuống)
    if (facilityId) {
        params.push(facilityId);
        baseWhere += ` AND t.facility_id = $${params.length}`;
    }

    // Filter theo Phòng ban (Nếu không xem theo cơ sở)
    if (departmentCode && !facilityId) {
        params.push(departmentCode);
        baseWhere += ` AND t.department_code = $${params.length}`;
    }

    // Nhân viên cục bộ chỉ thấy task của mình (Nếu không phải Global Roles / Quản lý cơ sở)
    const globalRoles = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD', 'ADMIN'];
    if (!globalRoles.includes(role) && role !== 'FACILITY_MANAGER') {
        params.push(userId, userId);
        baseWhere += ` AND (t.created_by = $${params.length - 1} OR t.pic_id = $${params.length})`;
    }

    // Filter theo Status
    if (status) {
        params.push(status);
        baseWhere += ` AND t.status = $${params.length}`;
    } else {
        baseWhere += ` AND (t.status != 'done' OR (t.status = 'done' AND t.updated_at >= date_trunc('month', CURRENT_DATE)))`;
    }

    // Lấy tổng số lượng để tính Meta Pagination
    const countQuery = `SELECT COUNT(t.id) as total FROM tasks t WHERE ${baseWhere}`;
    const countRes = await pool.query(countQuery, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    // Móc dữ liệu phân trang với CTE Siêu tốc & LEFT JOIN bảng task_operations
    params.push(limit, offset);
    const dataQuery = `
        WITH paginated_tasks AS (
            SELECT id, title, description, status, urgency, deadline, created_at, updated_at, needs_support, priority_level, pic_id, facility_id, department_code
            FROM tasks t
            WHERE ${baseWhere}
            ORDER BY t.updated_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        )
        SELECT pt.id, pt.title, pt.description as desc, pt.status, pt.urgency as urgent, 
               TO_CHAR(pt.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
               pt.created_at as "createdAt", pt.updated_at as "completedAt",
               pt.needs_support as "needsSupport",
               CASE WHEN pt.priority_level = '5' OR pt.priority_level = '3' THEN 5 WHEN pt.priority_level = '2' THEN 3 ELSE 0 END as priority_stars,
               u.full_name as pic, u.email as "picId",
               f.name as facility, f.code as "facilityId",
               pt.facility_id as "facilityRawId",
               pt.department_code as "department_tag",
               top.clocker_present, top.clocker_absent_excused, top.clocker_absent_unexcused,
               top.ktv_present, top.ktv_ids_present, top.ktv_absent_excused, top.ktv_ids_absent_excused,
               top.ktv_absent_unexcused, top.ktv_ids_absent_unexcused, top.machinery_ok, 
               top.cleaning_done, top.repair_needed, top.incidents, top.shift,
               COUNT(tc.id) AS comment_count
        FROM paginated_tasks pt
        LEFT JOIN users u ON pt.pic_id = u.id
        LEFT JOIN facilities f ON pt.facility_id = f.id AND f.is_deleted = false
        LEFT JOIN task_operations top ON pt.id = top.task_id
        LEFT JOIN task_comments tc ON pt.id = tc.task_id
        GROUP BY pt.id, pt.title, pt.description, pt.status, pt.urgency, pt.deadline, pt.created_at, pt.updated_at, pt.needs_support, pt.priority_level, 
                 u.full_name, u.email, f.name, f.code, pt.facility_id, pt.department_code,
                 top.clocker_present, top.clocker_absent_excused, top.clocker_absent_unexcused,
                 top.ktv_present, top.ktv_ids_present, top.ktv_absent_excused, top.ktv_ids_absent_excused,
                 top.ktv_absent_unexcused, top.ktv_ids_absent_unexcused, top.machinery_ok, 
                 top.cleaning_done, top.repair_needed, top.incidents, top.shift
        ORDER BY pt.updated_at DESC
    `;

    const { rows } = await pool.query(dataQuery, params);

    return { totalRecords, rows };
};

module.exports = { getTasksList };
