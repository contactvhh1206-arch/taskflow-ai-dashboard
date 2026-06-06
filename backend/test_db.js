require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testInsert() {
  try {
    const res = await pool.query(`
      INSERT INTO ai_chat_messages (session_id, role, content)
      VALUES ('test_session', 'assistant', '')
      RETURNING *
    `);
    console.log("Inserted row with empty string:", res.rows[0]);
    
    const res2 = await pool.query(`
      INSERT INTO ai_chat_messages (session_id, role, content)
      VALUES ('test_session', 'assistant', null)
      RETURNING *
    `);
    console.log("Inserted row with null:", res2.rows[0]);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    pool.end();
  }
}

testInsert();
