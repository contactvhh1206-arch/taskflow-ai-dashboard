const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM kpi_settings ORDER BY id ASC');
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: true, data: [] });
    }
});

module.exports = router;
