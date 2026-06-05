require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
async function test() {
  try {
    const res = await pool.query("SELECT id, full_name, role_id, facility_id, status FROM users WHERE role_id = 6");
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
test();
