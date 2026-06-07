const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/taskflow' });
pool.query('SELECT id, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 5')
  .then(res => { console.log(res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
