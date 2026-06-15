const pool = require('../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const loginHandler = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng cung cấp email và mật khẩu.' });
        }

        // Lệnh truy vấn Xóa mù Role (Bắt buộc JOIN để lấy tên quyền)
        const query = `
            SELECT u.id, u.password_hash, u.facility_id, u.department_code, u.full_name as name, u.email as username, r.name as role_name, u.managed_facilities
            FROM users u 
            LEFT JOIN roles r ON u.role_id = r.id 
            WHERE u.email = $1
        `;
        
        const { rows } = await pool.query(query, [email.trim().toLowerCase()]);

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Sai email hoặc mật khẩu.' });
        }

        const user = rows[0];

        // Giải mã băm (Hash)
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Sai email hoặc mật khẩu.' });
        }

        // Đúc Token Stateless 100% (The Iron Payload)
        const payload = {
            id: user.id,
            role: user.role_name,
            facility_id: user.facility_id,
            department_code: user.department_code,
            name: user.name || user.username || 'User',
            username: user.username,
            managed_facilities: user.managed_facilities || null
        };

        const token = jwt.sign(payload, process.env.SECRET_KEY || 'YOUR_SECRET_KEY', { expiresIn: '24h' });

        return res.status(200).json({
            success: true,
            token,
            user: payload
        });

    } catch (error) {
        console.error('[Auth Controller Error]:', error.message);
        return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi đăng nhập.' });
    }
};

module.exports = { loginHandler };
