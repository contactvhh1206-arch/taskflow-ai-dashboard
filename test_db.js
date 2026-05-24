const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgres://taskflow_user_3f7r:iRXYyHhS06X2tK5o6O2Lto1L8WvE1m12@dpg-cuseu5g8fa8c73ccpumg-a.singapore-postgres.render.com/taskflow_db_r9h1',
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    const res = await pool.query('SELECT * FROM facilities');
    console.log("FACILITIES:", res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
test();
