const pool = require('../config/database');

const getTasksList = async ({ userId, role, facilityId, departmentCode, status, limit, offset, start_date, end_date, urgency }) => {
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
        baseWhere += ` AND t.status NOT IN ('revoked', 'deleted') AND (t.status != 'done' OR (t.status = 'done' AND t.updated_at >= date_trunc('month', CURRENT_DATE)))`;
    }

    if (start_date) {
        params.push(start_date);
        baseWhere += ` AND t.created_at >= $${params.length}::date`;
    }
    if (end_date) {
        params.push(end_date);
        baseWhere += ` AND t.created_at <= $${params.length}::date + interval '1 day' - interval '1 second'`;
    }
    if (urgency === true || urgency === 'true') {
        baseWhere += ` AND t.urgency = true`;
    }

    // Lấy tổng số lượng để tính Meta Pagination
    const countQuery = `SELECT COUNT(t.id) as total FROM tasks t WHERE ${baseWhere}`;
    const countRes = await pool.query(countQuery, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    // Móc dữ liệu phân trang với CTE Siêu tốc & LEFT JOIN bảng task_operations
    params.push(limit, offset);
    const dataQuery = `
        WITH paginated_tasks AS (
            SELECT id, title, description, status, urgency, deadline, created_at, updated_at, needs_support, priority_level, pic_id, facility_id, department_code, created_by, created_by_role
            FROM tasks t
            WHERE ${baseWhere}
            ORDER BY t.updated_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        )
        SELECT pt.id, pt.title, pt.description as desc, pt.status, pt.urgency as urgent, 
               TO_CHAR(pt.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
               pt.created_at as "createdAt", pt.updated_at as "completedAt",
               pt.needs_support as "needsSupport",
               CASE WHEN pt.priority_level = 'CRITICAL' THEN 5 WHEN pt.priority_level = 'HIGH' THEN 3 WHEN pt.priority_level = '5' OR pt.priority_level = '3' THEN 5 WHEN pt.priority_level = '2' THEN 3 ELSE 0 END as priority_stars,
               u.full_name as pic, u.email as "picId", pt.pic_id,
               pt.created_by as "createdBy", pt.created_by_role as "creator_role",
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
        LEFT JOIN facilities f ON pt.facility_id = f.id
        LEFT JOIN task_operations top ON pt.id = top.task_id
        LEFT JOIN task_comments tc ON pt.id = tc.task_id
        GROUP BY pt.id, pt.title, pt.description, pt.status, pt.urgency, pt.deadline, pt.created_at, pt.updated_at, pt.needs_support, pt.priority_level, pt.pic_id, pt.created_by, pt.created_by_role, 
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

const getTasksHistory = async ({ userId, role, facilityId, departmentCode, picId, dateFrom, dateTo, limit, offset }) => {
    let baseWhere = `t.status = 'done'`;
    const params = [];

    if (facilityId && facilityId !== 'ALL') {
        params.push(facilityId);
        baseWhere += ` AND t.facility_id = $${params.length}`;
    }

    if (departmentCode && (!facilityId || facilityId === 'ALL')) {
        params.push(departmentCode);
        baseWhere += ` AND t.department_code = $${params.length}`;
    }

    const globalRoles = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD', 'ADMIN'];
    if (!globalRoles.includes(role) && role !== 'FACILITY_MANAGER') {
        params.push(userId, userId);
        baseWhere += ` AND (t.created_by = $${params.length - 1} OR t.pic_id = $${params.length})`;
    }

    if (picId) {
        params.push(`%${picId}%`);
        baseWhere += ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    if (dateFrom) {
        params.push(dateFrom);
        baseWhere += ` AND t.updated_at >= $${params.length}::date`;
    }
    if (dateTo) {
        params.push(dateTo);
        baseWhere += ` AND t.updated_at < $${params.length}::date + interval '1 day'`;
    }

    const countQuery = `
        SELECT COUNT(t.id) as total 
        FROM tasks t
        LEFT JOIN users u ON t.pic_id = u.id
        WHERE ${baseWhere}
    `;
    const countRes = await pool.query(countQuery, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    params.push(limit, offset);
    const dataQuery = `
        WITH paginated_tasks AS (
            SELECT t.id, t.title, t.description, t.status, t.urgency, t.deadline, t.created_at, t.updated_at, t.needs_support, t.priority_level, t.pic_id, t.facility_id, t.department_code, u.full_name, u.email
            FROM tasks t
            LEFT JOIN users u ON t.pic_id = u.id
            WHERE ${baseWhere}
            ORDER BY t.updated_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        )
        SELECT pt.id, pt.title, pt.description as desc, pt.status, pt.urgency as urgent, 
               TO_CHAR(pt.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
               pt.created_at as "createdAt", pt.updated_at as "completedAt",
               pt.needs_support as "needsSupport",
               CASE WHEN pt.priority_level = 'CRITICAL' THEN 5 WHEN pt.priority_level = 'HIGH' THEN 3 WHEN pt.priority_level = '5' OR pt.priority_level = '3' THEN 5 WHEN pt.priority_level = '2' THEN 3 ELSE 0 END as priority_stars,
               pt.full_name as pic, pt.email as "picId",
               f.name as facility, f.code as "facilityId",
               pt.facility_id as "facilityRawId",
               pt.department_code as "department_tag",
               COUNT(tc.id) AS comment_count
        FROM paginated_tasks pt
        LEFT JOIN facilities f ON pt.facility_id = f.id
        LEFT JOIN task_comments tc ON pt.id = tc.task_id
        GROUP BY pt.id, pt.title, pt.description, pt.status, pt.urgency, pt.deadline, pt.created_at, pt.updated_at, pt.needs_support, pt.priority_level, 
                 pt.full_name, pt.email, f.name, f.code, pt.facility_id, pt.department_code
        ORDER BY pt.updated_at DESC
    `;
    const { rows } = await pool.query(dataQuery, params);
    return { totalRecords, rows };
};

// --- CÁC HÀM HỖ TRỢ (HELPERS) ---

const getFacilityIdByNameOrCode = async (facilityNameOrCode) => {
    const query = 'SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1';
    const { rows } = await pool.query(query, [facilityNameOrCode]);
    return rows.length > 0 ? rows[0].id : null;
};

// Truy xuất User với logic Tách biệt: Chuẩn Regex để giữ toàn vẹn Index
const getUserDetails = async (input) => {
    if (!input) return null;
    let query = '';
    let values = [input];

    // Nếu đầu vào chỉ chứa số -> Query theo ID (int4)
    if (/^\d+$/.test(input)) {
        query = 'SELECT id, facility_id, department_code FROM users WHERE id = $1 LIMIT 1';
        values = [parseInt(input, 10)];
    } else {
        // Gỡ bỏ luật @. Quét cả email và full_name
        query = 'SELECT id, full_name, facility_id, department_code FROM users WHERE email = $1 OR full_name = $1 LIMIT 1';
    }

    const { rows } = await pool.query(query, values);
    return rows.length > 0 ? rows[0] : null;
};

// --- HÀM THỰC THI CHÍNH TẠO TASK ---

const createNewTask = async (data) => {
    // Lệnh INSERT hard-coded chuẩn 100% với Schema của DDL
    // TUYỆT ĐỐI không dùng 'desc' hay 'urgent'. 
    // Đã thêm created_by_role (chuẩn varchar) vào SQL
    const insertQuery = `
      INSERT INTO tasks (
          title, 
          description, 
          status, 
          urgency, 
          deadline, 
          pic_id, 
          facility_id, 
          department_code, 
          priority_level, 
          created_by, 
          created_by_role, 
          created_at, 
          updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *;
    `;
    
    // Mảng map theo đúng thứ tự 11 tham số ($1 -> $11)
    const values = [
        data.title, 
        data.description, 
        data.status, 
        data.urgency, 
        data.deadline, 
        data.pic_id, 
        data.facility_id,
        data.department_code,
        data.priority_level,
        data.created_by,
        data.created_by_role
    ];

    const { rows } = await pool.query(insertQuery, values);
    return rows[0];
};

module.exports = { 
    getTasksList, 
    getTasksHistory, 
    getFacilityIdByNameOrCode, 
    getUserDetails, 
    createNewTask 
};
