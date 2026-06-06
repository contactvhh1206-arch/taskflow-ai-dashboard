const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');

router.get('/', authGuard, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT key, value FROM system_config');
        const data = {};
        rows.forEach(row => {
            data[row.key] = row.value;
        });
        res.json({ success: true, data });
    } catch (error) {
        console.error('Lỗi khi lấy config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', authGuard, async (req, res) => {
    try {
        const { ai_config, system_prompts } = req.body;
        
        // Cập nhật cấu hình vào Database bằng cơ chế Upsert thủ công để tương thích
        const upsertConfig = async (key, value) => {
            const { rows } = await pool.query('SELECT id FROM system_config WHERE key = $1', [key]);
            if (rows.length > 0) {
                await pool.query('UPDATE system_config SET value = $2 WHERE key = $1', [key, JSON.stringify(value)]);
            } else {
                await pool.query('INSERT INTO system_config (key, value) VALUES ($1, $2)', [key, JSON.stringify(value)]);
            }
        };

        if (ai_config) await upsertConfig('taskflow_ai_config', ai_config);
        if (system_prompts) await upsertConfig('taskflow_system_prompts', system_prompts);

        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi khi lưu config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
