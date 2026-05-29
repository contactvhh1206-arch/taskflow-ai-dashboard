const { Pool } = require("pg");
const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/hub_dubai"
});
async function run() {
  const res = await pool.query(`SELECT jsonb_typeof(data) AS type, data FROM daily_financial_reports WHERE data::text ILIKE '%DB41%' LIMIT 1`);
  console.log(JSON.stringify(res.rows, null, 2));
  pool.end();
}
run();
