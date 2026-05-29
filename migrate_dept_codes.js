import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function runMigration() {
  try {
    console.log("Starting Migration...");
    
    // MARKETING
    const res1 = await pool.query(`
      UPDATE tasks 
      SET department_code = 'MARKETING' 
      WHERE department_code ILIKE '%Truyền%' OR department_code ILIKE '%MKT%' OR department_code IS NULL
    `);
    console.log(`Updated ${res1.rowCount} rows to MARKETING.`);

    // ACCOUNTING
    const res2 = await pool.query(`
      UPDATE tasks 
      SET department_code = 'ACCOUNTING' 
      WHERE department_code ILIKE '%Kế toán%' OR department_code ILIKE '%Ke toan%' OR department_code ILIKE '%ACC%'
    `);
    console.log(`Updated ${res2.rowCount} rows to ACCOUNTING.`);

    // HR
    const res3 = await pool.query(`
      UPDATE tasks 
      SET department_code = 'HR' 
      WHERE department_code ILIKE '%Nhân sự%' OR department_code ILIKE '%Nhan su%' OR department_code ILIKE '%HR%'
    `);
    console.log(`Updated ${res3.rowCount} rows to HR.`);

  } catch (err) {
    console.error("Migration Error:", err);
  } finally {
    await pool.end();
  }
}

runMigration();
