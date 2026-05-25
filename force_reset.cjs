const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgres://taskflow_user_3f7r:iRXYyHhS06X2tK5o6O2Lto1L8WvE1m12@dpg-cuseu5g8fa8c73ccpumg-a.singapore-postgres.render.com/taskflow_db_r9h1',
  ssl: { rejectUnauthorized: false }
});

async function resetDB() {
  try {
    console.log("Truncating tasks...");
    await pool.query('DELETE FROM tasks');
    
    console.log("Deleting daily_logs except SYSTEM_CONFIG...");
    await pool.query('DELETE FROM daily_logs WHERE entry_type != $1', ['SYSTEM_CONFIG']);
    
    console.log("Deleting daily_financial_reports...");
    await pool.query('DELETE FROM daily_financial_reports');
    
    console.log("RESET SUCCESSFUL!");
  } catch(e) {
    console.error("ERROR:", e);
  } finally {
    pool.end();
  }
}
resetDB();
