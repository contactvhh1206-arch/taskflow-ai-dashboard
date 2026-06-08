const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/taskflow' });

async function check() {
    try {
        console.log("=== THÔNG TIN USER db41 ===");
        const { rows: users } = await pool.query(`SELECT id, email, full_name, role, facility_id, department_code FROM users WHERE email = 'db41' OR id = 25`);
        console.log(users);
        const db41Id = users[0].id;
        const facilityId = users[0].facility_id;

        console.log(`\n=== TASKS ĐƯỢC GIAO CHO db41 (pic_id = ${db41Id}) ===`);
        const { rows: tasks } = await pool.query(`SELECT id, title, status, pic_id, facility_id, department_code, created_by_role FROM tasks WHERE pic_id = $1`, [db41Id]);
        console.log(tasks);

        console.log(`\n=== QUERY TEST FACILITY MANAGER GET TASKS ===`);
        // Giả lập logic trong getTasksList cho FACILITY_MANAGER
        // baseWhere: t.facility_id = $1 (với facilityId của user)
        const args = [facilityId];
        const { rows: managerTasks } = await pool.query(`
            SELECT id, title, status, pic_id, facility_id 
            FROM tasks t 
            WHERE t.facility_id = $1 
              AND t.status NOT IN ('revoked', 'deleted')
        `, args);
        console.log(managerTasks);

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

check();
