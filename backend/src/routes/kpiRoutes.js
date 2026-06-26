const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const authGuard = require('../middlewares/authGuard');

// GET /api/kpi?month=6/2026  → lấy KPI theo tháng cụ thể
// GET /api/kpi               → lấy bản ghi mới nhất
router.get('/', authGuard, async (req, res) => {
    try {
        const { month } = req.query;
        let rows;
        if (month) {
            // Lấy KPI theo tháng chỉ định
            const result = await pool.query(
                'SELECT * FROM kpi_settings WHERE apply_month = $1 LIMIT 1',
                [month]
            );
            rows = result.rows;
        } else {
            // Lấy bản ghi mới nhất nếu không chỉ định tháng
            const result = await pool.query(
                'SELECT * FROM kpi_settings ORDER BY updated_at DESC LIMIT 1'
            );
            rows = result.rows;
        }
        res.json({ success: true, data: rows[0] || {} });
    } catch (e) {
        console.error('Lỗi lấy KPI:', e);
        res.json({ success: true, data: {} });
    }
});

// GET /api/kpi/months → trả danh sách tất cả tháng đã có KPI trong DB
router.get('/months', authGuard, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT apply_month FROM kpi_settings ORDER BY updated_at DESC'
        );
        const months = rows.map(r => r.apply_month).filter(Boolean);
        res.json({ success: true, data: months });
    } catch (e) {
        console.error('Lỗi lấy danh sách tháng KPI:', e);
        res.json({ success: true, data: [] });
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
                'UPDATE kpi_settings SET data = $2, updated_at = NOW() WHERE apply_month = $1',
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
