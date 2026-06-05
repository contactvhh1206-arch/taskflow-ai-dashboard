const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');

// Lấy tối đa 5 thông báo chưa đọc
router.get('/unread', authGuard, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT * FROM ai_notifications 
            WHERE user_id = $1 AND is_read = false 
            ORDER BY created_at DESC 
            LIMIT 5
        `, [req.user.id]);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Đánh dấu đã đọc
router.put('/:id/read', authGuard, async (req, res) => {
    try {
        await pool.query(
            'UPDATE ai_notifications SET is_read = true WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
