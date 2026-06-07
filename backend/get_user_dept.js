require('dotenv').config({ path: __dirname + '/src/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:123456@localhost:5432/hub_dubai',
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render') ? { rejectUnauthorized: false } : false
});

async function checkUser() {
  try {
    const res = await pool.query(`SELECT id, email, full_name, role_id, facility_id, department_code FROM users WHERE full_name LIKE '%Thiện%' OR email LIKE '%thien%'`);
    console.log("User Thiện:", res.rows);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    pool.end();
  }
}

checkUser();
