require('dotenv').config();
const pool = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', '002_task_audit_logs.sql'), 'utf8');
    try {
        console.log('Running migration 002_task_audit_logs.sql...');
        await pool.query(sql);
        console.log('[OK] Migration completed successfully.');
    } catch (err) {
        console.error('[ERROR] Migration failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
