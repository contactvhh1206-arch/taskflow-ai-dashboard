const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/taskflow' });

const getTasksList = async () => {
    let baseWhere = `1=1`;
    baseWhere += ` AND t.status NOT IN ('revoked', 'deleted') AND (t.status != 'done' OR (t.status = 'done' AND t.updated_at >= date_trunc('month', CURRENT_DATE)))`;
    
    const query = `
        WITH paginated_tasks AS (
            SELECT id, title, description, status, urgency, deadline, created_at, updated_at, needs_support, priority_level, pic_id, facility_id, department_code, created_by, created_by_role
            FROM tasks t
            WHERE ${baseWhere}
            ORDER BY t.updated_at DESC
            LIMIT 50 OFFSET 0
        )
        SELECT pt.id, pt.title, pt.description as desc, pt.status, pt.urgency as urgent, 
               TO_CHAR(pt.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
               u.full_name as pic, u.email as "picId", pt.pic_id,
               pt.created_by as "createdBy", pt.created_by_role as "creator_role",
               f.name as facility, f.code as "facilityId",
               pt.facility_id as "facilityRawId",
               pt.department_code as "department_tag",
               COUNT(tc.id) AS comment_count
        FROM paginated_tasks pt
        LEFT JOIN users u ON pt.pic_id = u.id
        LEFT JOIN facilities f ON pt.facility_id = f.id AND f.is_deleted = false
        LEFT JOIN task_operations top ON pt.id = top.task_id
        LEFT JOIN task_comments tc ON pt.id = tc.task_id
        GROUP BY pt.id, pt.title, pt.description, pt.status, pt.urgency, pt.deadline, pt.created_at, pt.updated_at, pt.needs_support, pt.priority_level, pt.pic_id, pt.created_by, pt.created_by_role, 
                 u.full_name, u.email, f.name, f.code, pt.facility_id, pt.department_code
        ORDER BY pt.updated_at DESC
    `;
    
    try {
        const { rows } = await pool.query(query);
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
};

getTasksList();
