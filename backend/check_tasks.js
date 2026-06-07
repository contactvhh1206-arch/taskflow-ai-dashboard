const pool = require('./src/config/database');

async function test() {
    try {
        const { rows } = await pool.query('SELECT id, title, facility_id, pic_id, created_by FROM tasks WHERE id IN (26, 52, 20)');
        console.table(rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

test();
