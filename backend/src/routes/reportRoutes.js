const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');

router.get('/', authGuard, async (req, res) => {
    try {
        // Attempt to fetch from daily_financial_reports, fallback to empty array if table doesn't exist
        const { rows } = await pool.query('SELECT * FROM daily_financial_reports ORDER BY created_at DESC LIMIT 100');
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: true, data: [] });
    }
});

router.post('/', authGuard, async (req, res) => {
    try {
        const payload = req.body;
        const items = Array.isArray(payload) ? payload : [payload];
        const results = [];

        const query = `
            INSERT INTO daily_financial_reports (id, date, total_revenue, data, created_by, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (date) DO UPDATE 
            SET total_revenue = EXCLUDED.total_revenue,
                data = EXCLUDED.data,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        for (const item of items) {
            const { rows } = await pool.query(query, [
                item.id,
                item.date,
                item.totalRevenue,
                JSON.stringify(item.data),
                item.createdBy,
                item.timestamp
            ]);
            if (rows.length > 0) {
                results.push(rows[0]);
            }
        }

        res.json({ success: true, data: Array.isArray(payload) ? results : results[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
