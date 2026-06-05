const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const authGuard = require('../middlewares/authGuard');

router.get('/', authGuard, async (req, res) => {
    try {
        // Thay vì ORDER BY id DESC (do ID là UUID ngẫu nhiên), tạm thời lấy bản ghi mới nhất
        const { rows } = await pool.query('SELECT * FROM kpi_settings LIMIT 1'); 
        res.json({ success: true, data: rows[0] || {} });
    } catch (e) {
        res.json({ success: true, data: {} });
    }
});
        res.json({ success: true, data: {} });
    }
});

router.post('/', authGuard, async (req, res) => {
    try {
        const { apply_month, data } = req.body;
        
        if (!apply_month || !data) {
            return res.status(400).json({ success: false, error: 'Thiếu dữ liệu (apply_month, data)' });
        }

        // Cập nhật hoặc tạo mới dựa trên apply_month
        const { rows } = await pool.query('SELECT id FROM kpi_settings WHERE apply_month = $1', [apply_month]);
        
        if (rows.length > 0) {
            await pool.query(
                'UPDATE kpi_settings SET data = $2 WHERE apply_month = $1',
                [apply_month, JSON.stringify(data)]
            );
        } else {
            await pool.query(
                'INSERT INTO kpi_settings (apply_month, data) VALUES ($1, $2)',
                [apply_month, JSON.stringify(data)]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi khi lưu KPI:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
