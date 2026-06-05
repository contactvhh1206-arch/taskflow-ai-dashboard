const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
    try {
        // We'll catch and return empty array if table doesn't exist
        const { rows } = await pool.query('SELECT * FROM logs ORDER BY created_at DESC LIMIT 50');
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: true, data: [] });
    }
});

module.exports = router;
