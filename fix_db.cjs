const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://taskflow_db_328p_user:6E6G6eB1A4VlP6b85H9r8W154i4K0k7m@dpg-cu141a0gph6c73cdv56g-a.singapore-postgres.render.com/taskflow_db_328p',
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  try {
    console.log("Executing ALTER TABLE...");
    await pool.query('ALTER TABLE facilities ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;');
    console.log("ALTER TABLE Success.");

    console.log("Checking information_schema...");
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='facilities' AND column_name='is_deleted';");
    
    console.log("Validation Result:");
    res.rows.forEach(row => {
      console.log(`Column found: ${row.column_name}`);
    });
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
fix();
