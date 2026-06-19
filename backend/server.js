require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pool = require('./src/config/database');

const app = express();

// 1. Khởi tạo Middlewares Mặc định
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1.1 Auto-run Migrations khi server khởi động
(async () => {
    const migrationFiles = ['001_create_ai_chat_messages.sql', '002_task_audit_logs.sql', '003_task_extension_request.sql'];
    for (const file of migrationFiles) {
        const migPath = path.join(__dirname, 'migrations', file);
        if (fs.existsSync(migPath)) {
            try {
                const sql = fs.readFileSync(migPath, 'utf8');
                await pool.query(sql);
                console.log(`[MIGRATION OK] ${file}`);
            } catch (err) {
                // Bỏ qua nếu bảng/index đã tồn tại (IF NOT EXISTS đã xử lý)
                console.warn(`[MIGRATION WARN] ${file}:`, err.message);
            }
        }
    }
})();

// 1.5 Đề nổ Động cơ Cron
require('./src/cron/aiPingJob');

// 2. Định tuyến Toàn cục (Mount The Iron Gateway)
app.use('/api', require('./src/routes/index'));

// 3. Global Error Handler (Lưới vớt lỗi cuối cùng)
app.use((err, req, res, next) => {
    console.error('[Global Error]:', err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Internal Server Error. Vui lòng liên hệ Quản trị viên.' 
    });
});

// 4. Khởi động Máy chủ
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`[SYSTEM] Server is running on port ${PORT}`);
    console.log(`[SYSTEM] Cỗ máy MVC và Lớp Khiên Thép đã vận hành!`);
});

