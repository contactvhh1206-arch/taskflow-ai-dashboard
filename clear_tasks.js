const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgres://taskflow_user_3f7r:iRXYyHhS06X2tK5o6O2Lto1L8WvE1m12@dpg-cuseu5g8fa8c73ccpumg-a.singapore-postgres.render.com/taskflow_db_r9h1',
  ssl: { rejectUnauthorized: false }
});

async function clearTasks() {
  try {
    await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    console.log("TASKS CLEARED");
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
clearTasks();
