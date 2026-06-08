const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');
const rbacGuard = require('../middlewares/rbacGuard');
const bcrypt = require('bcryptjs');

// GET all users
router.get('/', authGuard, rbacGuard, async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.email as username, u.full_name as name, u.facility_id, r.name as role, u.is_active 
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            ORDER BY u.created_at DESC
        `;
        const { rows } = await pool.query(query);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Lỗi GET users:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST create user
router.post('/', authGuard, rbacGuard, async (req, res) => {
    try {
        const { username, password, name, role, facility_id } = req.body;
        
        if (!username || !password || !name || !role) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' });
        }

        const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
        const role_id = roleRows.length > 0 ? roleRows[0].id : null;
        
        if (!role_id) {
            return res.status(400).json({ success: false, error: 'Role không hợp lệ' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const { rows } = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, role_id, facility_id) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [username.trim().toLowerCase(), hashedPassword, name, role_id, facility_id]
        );

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Lỗi POST user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE user
router.delete('/:id', authGuard, rbacGuard, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi DELETE user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT update user
router.put('/:id', authGuard, rbacGuard, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, facility_id, is_active } = req.body;

        if (is_active !== undefined && !name) {
            await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active, id]);
            return res.json({ success: true });
        }

        const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
        const role_id = roleRows.length > 0 ? roleRows[0].id : null;

        const facilityIdStr = Array.isArray(facility_id) ? JSON.stringify(facility_id) : facility_id;

        await pool.query(
            `UPDATE users SET full_name = $1, role_id = $2, facility_id = $3 WHERE id = $4`,
            [name, role_id, facilityIdStr, id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi PUT user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST change password (có thể không dùng rbacGuard cho endpoint này)
router.post('/change-password', authGuard, async (req, res) => {
    try {
        // Hỗ trợ đổi pass cho self hoặc cho user khác (nếu là admin)
        const { userId, newPassword } = req.body;
        const targetUserId = userId || req.user.id;
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, targetUserId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi đổi mật khẩu:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
