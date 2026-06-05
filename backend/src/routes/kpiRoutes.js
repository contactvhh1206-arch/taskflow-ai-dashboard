const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const authGuard = require('../middlewares/authGuard');

router.get('/', authGuard, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM kpi_settings ORDER BY id DESC LIMIT 1');
        res.json({ success: true, data: rows[0] || {} });
    } catch (e) {
        res.json({ success: true, data: {} });
    }
});

router.post('/', authGuard, async (req, res) => {
    try {
        const { apply_month, data } = req.body;
        
        if (!apply_month || !data) {
            return res.status(400).json({ success: false, error: 'Thiếu dữ liệu (apply_month, data)' });
        }

        // Lưu bản ghi mới nhất
        await pool.query(
            'INSERT INTO kpi_settings (apply_month, data) VALUES ($1, $2)',
            [apply_month, JSON.stringify(data)]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi khi lưu KPI:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
