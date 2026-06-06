require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const res = await pool.query(`
      SELECT tgname, proname, prosrc 
      FROM pg_trigger
      JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'ai_chat_messages'::regclass;
    `);
    console.log("Triggers:", res.rows);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    pool.end();
  }
}

check();
