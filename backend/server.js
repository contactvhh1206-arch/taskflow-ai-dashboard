require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// 1. Khởi tạo Middlewares Mặc định
app.use(cors());
app.use(express.json());

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
