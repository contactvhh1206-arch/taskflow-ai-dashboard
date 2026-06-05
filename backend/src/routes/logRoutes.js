const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
    try {
        let query = 'SELECT * FROM daily_logs';
        let values = [];
        let conditions = [];

        if (req.query.org_unit) {
            conditions.push(`org_unit = $${values.length + 1}`);
            values.push(req.query.org_unit);
        }
        if (req.query.entry_type) {
            conditions.push(`entry_type = $${values.length + 1}`);
            values.push(req.query.entry_type);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY id DESC LIMIT 100';

        const { rows } = await pool.query(query, values);
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

