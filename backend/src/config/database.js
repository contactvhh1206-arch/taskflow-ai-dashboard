const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Fallback thông số rời rạc nếu không có connectionString
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'taskflow',
    port: process.env.DB_PORT || 5432,
});

module.exports = pool;
