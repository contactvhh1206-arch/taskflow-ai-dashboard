const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM daily_logs ORDER BY id DESC LIMIT 50');
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error("Lỗi GET /api/logs:", e);
        res.json({ success: true, data: [] });
    }
});

router.post('/', async (req, res) => {
    try {
        const { org_unit, entry_type, content, attachments, ai_vector_data, date, display_time } = req.body;
        
        const contentJson = typeof content === 'object' ? JSON.stringify(content) : content;
        const attachmentsJson = Array.isArray(attachments) ? JSON.stringify(attachments) : JSON.stringify([]);

        const { rows } = await pool.query(
            `INSERT INTO daily_logs (org_unit, entry_type, content, attachments, ai_vector_data, date, display_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [org_unit, entry_type, contentJson, attachmentsJson, ai_vector_data || '', date, display_time]
        );
        res.json({ success: true, data: rows[0] });
    } catch (e) {
        console.error("Lỗi POST /api/logs:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;

