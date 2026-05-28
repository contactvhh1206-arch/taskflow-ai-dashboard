import express from 'express';
import jwt from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET || 'HubDB_Global_Temp_Secret_2026_!!!';
import cors from 'cors';
import fetch from 'node-fetch'; 
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const normalizeDept = (code) => {
    if (!code) return '';
    let normalized = code.toString().trim().toUpperCase();
    normalized = normalized.replace(/^PHÒNG\s+/i, '').replace(/^PHONG\s+/i, '');
    if (normalized === 'MKT') return 'MARKETING';
    return normalized;
};

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  connectionTimeoutMillis: 5000,
});

const app = express();

// ==========================================
// NOTIFICATIONS SSE STATE
// ==========================================
const sseClients = new Map();

setInterval(() => {
    sseClients.forEach((res, userId) => {
        try {
            res.write(':\n\n'); // Ping
        } catch (err) {
            sseClients.delete(userId);
        }
    });
}, 15000);

async function sendRealtimeNotification(userId, type, message, taskId = null, actorId = null) {
    if (!userId) return;
    try {
        const notifRes = await pool.query(`
            INSERT INTO notifications (user_id, task_id, type, message, actor_id)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [userId, taskId, type, message, actorId]);
        
        const newNotif = notifRes.rows[0];
        
        if (sseClients.has(parseInt(userId))) {
            sseClients.get(parseInt(userId)).write(`data: ${JSON.stringify(newNotif)}\n\n`);
        } else if (sseClients.has(String(userId))) {
            sseClients.get(String(userId)).write(`data: ${JSON.stringify(newNotif)}\n\n`);
        }
    } catch (e) {
        console.error("Error saving/sending notification:", e);
    }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Database Schema Updates & Roles
const initDB = async () => {
  try {
    console.log('[DB] Running initialization checks...');
    // Add missing columns to users if not exists
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_facilities JSONB`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ACTIVE'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
    await pool.query(`ALTER TABLE facilities ADD COLUMN IF NOT EXISTS address VARCHAR(255)`);
    await pool.query(`ALTER TABLE facilities ADD COLUMN IF NOT EXISTS pic VARCHAR(255)`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS needs_support BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE tasks ALTER COLUMN deadline TYPE TIMESTAMP USING deadline::TIMESTAMP`);
    await pool.query(`CREATE TABLE IF NOT EXISTS daily_logs (
      id SERIAL PRIMARY KEY,
      org_unit VARCHAR(255),
      entry_type VARCHAR(255),
      content JSONB,
      attachments JSONB,
      ai_vector_data TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date VARCHAR(50),
      display_time VARCHAR(50)
    )`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_chat_sessions (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255),
      facility VARCHAR(255),
      title VARCHAR(255),
      chat_log JSONB,
      timestamp BIGINT
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS daily_financial_reports (
      id VARCHAR(255) PRIMARY KEY,
      date VARCHAR(50) UNIQUE,
      total_revenue NUMERIC(15,2),
      data JSONB,
      created_by VARCHAR(255),
      timestamp VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS kpi_settings (
      id VARCHAR(255) PRIMARY KEY,
      apply_month VARCHAR(50),
      data JSONB,
      updated_by VARCHAR(255),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS system_config (
      key VARCHAR(255) PRIMARY KEY,
      data JSONB,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Comments table
    await pool.query(`CREATE TABLE IF NOT EXISTS task_comments (
        id SERIAL PRIMARY KEY,
        task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    // Notifications table
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        actor_id INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);
    // Seed roles
    const roles = ['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD', 'FACILITY_MANAGER', 'ADMIN'];
    for (const role of roles) {
      await pool.query(`INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [role]);
    }
    console.log('[DB] Initialization complete.');
  } catch (error) {
    console.error('[DB] Initialization error:', error.message);
  }
};
initDB();

// ==============================================================================
// 1. MOCK DATABASE & MIDDLEWARE PHÂN QUYỀN (RBAC)
// ==============================================================================

const mockTasks = [
  { id: 1, title: 'Bảo trì máy lạnh', facility_id: 1, pic_id: 2, pic_name: 'Trần Thị B', status: 'todo', deadline: '2026-05-15' },
  { id: 2, title: 'Nghiệm thu KPI', facility_id: 2, pic_id: 3, pic_name: 'Lê Văn C', status: 'review', deadline: '2026-05-12' }, // Trễ 2 ngày
  { id: 3, title: 'Lên chiến dịch Ads', facility_id: 'ALL', pic_id: 4, pic_name: 'Phạm D', status: 'in_progress', deadline: '2026-05-10' } // Trễ 4 ngày
];

// Bảng Log Nhắc việc AI (Công khai cho Sếp Tổng / Tổng quản lý)
const mockAiPingLogs = [];

// ==============================================================================
// DAILY LOGS API
// ==============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM daily_logs ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ error: `Lỗi server: ${error.message}` });
  }
});

app.post('/api/logs', async (req, res) => {
  try {
    const { org_unit, entry_type, content, attachments, ai_vector_data, date, display_time } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO daily_logs (org_unit, entry_type, content, attachments, ai_vector_data, date, display_time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [org_unit, entry_type, JSON.stringify(content || {}), JSON.stringify(attachments || []), ai_vector_data, date, display_time]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ error: `Lỗi server: ${error.message}` });
  }
});

// ==============================================================================
// 1. FACILITIES API (DATABASE BACKED)
// ==============================================================================
app.get('/api/facilities', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM facilities ORDER BY id ASC');
    const mapped = rows.map(r => ({ ...r, is_active: r.status === 'ACTIVE' }));
    res.json({ success: true, data: mapped });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi lấy danh sách cơ sở' });
  }
});

app.post('/api/facilities', async (req, res) => {
  try {
    const { name, address, code } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên cơ sở không được để trống.' });
    
    let facCode = code || name.replace(/\s+/g, '').toUpperCase();
    const { rows } = await pool.query(
      `INSERT INTO facilities (name, code, status) VALUES ($1, $2, 'ACTIVE') RETURNING *`, 
      [name.trim(), facCode]
    );
    res.json({ success: true, data: { ...rows[0], is_active: true } });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi khi tạo cơ sở (có thể trùng mã).' });
  }
});

app.put('/api/facilities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, pic } = req.body;
    
    // First check if the facility exists
    const checkRes = await pool.query('SELECT * FROM facilities WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy cơ sở.' });

    // Update facility
    const { rows } = await pool.query(
      `UPDATE facilities SET name = $1, address = $2, pic = $3 WHERE id = $4 RETURNING *`,
      [name, address, pic, id]
    );
    res.json({ success: true, data: { ...rows[0], is_active: rows[0].status === 'ACTIVE' } });
  } catch (error) {
    console.error('Update facility error:', error);
    res.status(500).json({ error: 'Lỗi server khi cập nhật cơ sở.' });
  }
});

app.put('/api/facilities/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`UPDATE facilities SET status = 'INACTIVE' WHERE id = $1 RETURNING *`, [id]);
    if(rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy cơ sở.' });
    res.json({ success: true, data: { ...rows[0], is_active: false } });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.put('/api/facilities/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`UPDATE facilities SET status = 'ACTIVE' WHERE id = $1 RETURNING *`, [id]);
    if(rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy cơ sở.' });
    res.json({ success: true, data: { ...rows[0], is_active: true } });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.delete('/api/facilities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Clear references to bypass foreign key constraints
    await pool.query(`UPDATE users SET facility_id = NULL WHERE facility_id = $1`, [id]).catch(e => console.log('Ignore users update error:', e.message));
    await pool.query(`DELETE FROM tasks WHERE facility_id = $1`, [id]).catch(e => console.log('Ignore tasks delete error:', e.message));
    
    await pool.query(`DELETE FROM facilities WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete facility error:', error);
    res.status(500).json({ error: 'DB Error: ' + error.message });
  }
});


const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
        }

        const token = authHeader.split(' ')[1];
        let userId = null;
        let userRole = null;
        let facilityRaw = null;
        let departmentId = null;

        try {
            const payload = jwt.verify(token, SECRET_KEY);
            userId = payload.id;
            userRole = payload.role;
            facilityRaw = payload.facility_id;
            departmentId = payload.department_id;
        } catch (jwtErr) {
            if (token === 'mock-jwt-token-admin') {
                userId = 1; userRole = 'SUPER_ADMIN'; facilityRaw = 'ALL';
            } else if (token === 'mock-jwt-token-manager') {
                userId = 2; userRole = 'FACILITY_MANAGER'; facilityRaw = '1';
            } else if (token === 'mock-jwt-token-sysadmin') {
                userId = 3; userRole = 'ADMIN'; facilityRaw = 'ALL';
            } else if (token.startsWith('jwt-token-')) {
                userId = parseInt(token.replace('jwt-token-', ''), 10);
                userRole = req.headers['x-user-role'];
                facilityRaw = req.headers['x-facility-id'];
                departmentId = req.headers['x-department-id'];
            } else {
                console.error('[Auth Middleware] Lỗi giải mã Token:', jwtErr.message);
                return res.status(401).json({ success: false, message: 'Invalid or Expired Token' });
            }
        }
        
        let facilityId = parseInt(facilityRaw, 10);
        
        if (!userRole) return res.status(401).json({ error: 'Unauthorized' });

        if (isNaN(facilityId) && facilityRaw && facilityRaw !== 'ALL') {
            const facRes = await pool.query('SELECT id FROM facilities WHERE code ILIKE $1 OR name ILIKE $1 LIMIT 1', [facilityRaw]);
            if (facRes.rows.length > 0) {
                facilityId = facRes.rows[0].id;
            } else {
                facilityId = null;
            }
        } else if (facilityRaw === 'ALL') {
            facilityId = 'ALL';
        }
      
        req.user = { id: userId, role: userRole, facility_id: facilityId, department_id: departmentId };
        next();
    } catch (err) {
        console.error("Auth middleware error:", err);
        return res.status(500).json({ error: 'Lỗi xác thực nội bộ.' });
    }
};

// ==============================================================================
// 1.2. USERS & ROLES API (DATABASE BACKED)
// ==============================================================================
app.get('/api/roles', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM roles ORDER BY id ASC');
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi lấy danh sách vai trò' });
  }
});

app.get('/api/users/directory', authenticateUser, async (req, res) => {
  try {
    const { rows: users } = await pool.query('SELECT id AS user_id, email, full_name, role_id, facility_id FROM users');
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Lỗi lấy danh bạ:", error);
    res.status(500).json({ error: 'Lỗi server.' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email as username, u.full_name as name, r.name as role, u.status as "isActive", u.managed_facilities, f.name as facility_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN facilities f ON u.facility_id = f.id
      ORDER BY u.id ASC
    `);
    const mapped = rows.map(r => ({
      ...r,
      isActive: r.isActive === 'ACTIVE',
      facility_id: r.managed_facilities || r.facility_name || 'ALL'
    }));
    res.json({ success: true, data: mapped });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi lấy danh sách người dùng' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, name, role, facility_id } = req.body;
    
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password.trim(), salt);
    
    const roleRes = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    if (roleRes.rows.length === 0) return res.status(400).json({ error: 'Vai trò không hợp lệ.' });
    const role_id = roleRes.rows[0].id;
    
    let facId = null;
    let managedFacs = null;
    if (Array.isArray(facility_id)) {
      managedFacs = JSON.stringify(facility_id);
    } else if (facility_id !== 'ALL') {
      const facRes = await pool.query('SELECT id FROM facilities WHERE name = $1', [facility_id]);
      if (facRes.rows.length > 0) facId = facRes.rows[0].id;
    }
    
    const { rows } = await pool.query(`
      INSERT INTO users (email, password_hash, full_name, role_id, facility_id, managed_facilities, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE') RETURNING id
    `, [username.trim().toLowerCase(), hash, name, role_id, facId, managedFacs]);
    
    res.json({ success: true, data: { id: rows[0].id } });
  } catch (error) {
    console.error("Lỗi tạo user:", error);
    res.status(500).json({ error: 'Lỗi tạo tài khoản (có thể username đã tồn tại).' });
  }
});
// In-memory store for hardcoded accounts (for demo purposes)
const hardcodedPasswords = {
  'admin': 'admin123',
  'manager1': 'manager123',
  'sysadmin': 'admin123'
};

app.put('/api/users/change-password', authenticateUser, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    
    // Check hardcoded accounts first
    if (hardcodedPasswords[username]) {
      if (hardcodedPasswords[username] !== currentPassword) {
        return res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
      }
      hardcodedPasswords[username] = newPassword;
      return res.json({ success: true, message: 'Đổi mật khẩu thành công (tài khoản demo).' });
    }
    
    // Find user in DB
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1 OR full_name = $1`, [username]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy thông tin tài khoản.' });
    }
    
    const user = rows[0];
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash || '');
    const passToCheck = user.password || user.password_hash;
    
    if (!(isMatch || passToCheck === currentPassword || passToCheck === Buffer.from(currentPassword).toString('base64') || Buffer.from(passToCheck || '').toString('base64') === currentPassword)) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
    }
    
    // Update new password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    
    try {
      await pool.query('UPDATE users SET password_hash = $1, password = NULL WHERE id = $2', [hash, user.id]);
    } catch (dbErr) {
      // Fallback if 'password' column does not exist
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    }
    
    res.json({ success: true, message: 'Đổi mật khẩu thành công.' });
  } catch (error) {
    console.error("Lỗi đổi mật khẩu:", error);
    res.status(500).json({ error: 'Lỗi máy chủ khi đổi mật khẩu.' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, facility_id, password, isActive } = req.body;
    
    const roleRes = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    const role_id = roleRes.rows.length > 0 ? roleRes.rows[0].id : null;
    
    let facId = null;
    let managedFacs = null;
    if (Array.isArray(facility_id)) {
      managedFacs = JSON.stringify(facility_id);
    } else if (facility_id && facility_id !== 'ALL') {
      const facRes = await pool.query('SELECT id FROM facilities WHERE name = $1', [facility_id]);
      if (facRes.rows.length > 0) facId = facRes.rows[0].id;
    }

    let status = isActive !== undefined ? (isActive ? 'ACTIVE' : 'INACTIVE') : 'ACTIVE';
    
    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password.trim(), salt);
      await pool.query(`
        UPDATE users SET full_name = $1, role_id = $2, facility_id = $3, managed_facilities = $4, status = $5, password_hash = $6
        WHERE id = $7
      `, [name, role_id, facId, managedFacs, status, hash, id]);
    } else {
      await pool.query(`
        UPDATE users SET full_name = $1, role_id = $2, facility_id = $3, managed_facilities = $4, status = $5
        WHERE id = $6
      `, [name, role_id, facId, managedFacs, status, id]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Lỗi cập nhật user:", error);
    res.status(500).json({ error: 'Lỗi cập nhật tài khoản.' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Không thể xóa user vì đang có dữ liệu công việc liên quan.' });
  }
});

app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const { role, facility_id } = req.user;
    
    let query = `
      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt",
             t.needs_support as "needsSupport",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId",
             COUNT(tc.id) AS comment_count
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id
      LEFT JOIN task_comments tc ON t.id = tc.task_id
      WHERE 1=1
    `;
      const params = [];
      if (role === 'SUPER_ADMIN' || role === 'VICE_PRESIDENT') {
          // Không nối thêm AND. Đặc quyền xem toàn bộ hệ thống.
      } else if (role === 'FACILITY_MANAGER') {
          // Lọc theo cơ sở
          params.push(req.user.facility_id);
          query += ` AND t.facility_id = $${params.length}`;
      } else {
          // Lọc theo phòng ban (Dành cho DEPARTMENT_HEAD và LOCAL)
          const userDept = normalizeDept(req.user.department_code || req.user.department_id);
          params.push(userDept);
          query += ` AND t.department_code = $${params.length}`;
      }
      
      query += ` GROUP BY t.id, u.full_name, u.email, f.name, f.code ORDER BY t.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Lỗi chi tiết từ DB:", error.message, error.stack);
    res.status(500).json({ error: 'Lỗi server.' });
  }
});

app.put('/api/tasks/:id/status', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, evidence } = req.body;
    
    const updateQuery = `
      UPDATE tasks 
      SET status = $1, 
          updated_at = NOW() 
      WHERE id = $2 
      RETURNING id, title, description as desc, status, urgency as urgent, TO_CHAR(deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, created_at as "createdAt"
    `;
    const { rows } = await pool.query(updateQuery, [status, id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy công việc.' });
    }
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Lỗi cập nhật trạng thái:", error);
    res.status(500).json({ error: 'Lỗi server khi cập nhật trạng thái.' });
  }
});

app.put('/api/tasks/:id/support', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const updateQuery = `
      UPDATE tasks 
      SET needs_support = true, 
          updated_at = NOW() 
      WHERE id = $1 
      RETURNING id, title, needs_support as "needsSupport"
    `;
    const { rows } = await pool.query(updateQuery, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy công việc.' });
    }

    res.json({ success: true, message: 'Đã gửi yêu cầu hỗ trợ đến Ban Giám Đốc', data: rows[0] });
  } catch (error) {
    console.error("Lỗi server khi yêu cầu hỗ trợ:", error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});


app.get('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT c.*, u.full_name as user_name, r.name as user_role 
      FROM task_comments c 
      LEFT JOIN users u ON c.user_id = u.id 
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE c.task_id = $1 
      ORDER BY c.created_at ASC
    `, [id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[API GET Comment] Lỗi 500:", err);
    res.status(500).json({ success: false, error: 'Lỗi tải bình luận: ' + err.message });
  }
});

app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const comment = req.body.comment || req.body.content;
    if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });

    // 1. LẤY USER_ID AN TOÀN VÀ CHẶN NGAY NẾU RỖNG (Nguyên nhân gốc gây sập)
    let realUserId = null;
    try {
        if (req.user && req.user.id) {
            realUserId = req.user.id;
        } else {
            const roleHeader = req.headers['x-user-role'];
            if (roleHeader) {
                const roleRes = await pool.query('SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = $1 LIMIT 1', [roleHeader]);
                if (roleRes.rows.length > 0) realUserId = roleRes.rows[0].id;
            }
        }
        
        if (!realUserId) {
            const fallbackRes = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
            if (fallbackRes.rows.length > 0) realUserId = fallbackRes.rows[0].id;
        }
    } catch (parseErr) {
        console.error("Lỗi parse user an toàn:", parseErr);
    }

    // [QUAN TRỌNG NHẤT]: TRẠM GÁC CHỐNG SẬP DB
    if (!realUserId) {
        return res.status(403).json({ error: 'Không thể xác định danh tính. Vui lòng đăng nhập lại!' });
    }

    // 2. THỰC THI INSERT (Lúc này realUserId đã được đảm bảo 100% là an toàn)
    const { rows } = await pool.query(`
      INSERT INTO task_comments (task_id, user_id, content)
      VALUES ($1, $2, $3) RETURNING *
    `, [id, realUserId, comment]);
    


        // 4. KHỞI TẠO BIẾN TRẢ VỀ TỪ CƠ SỞ DỮ LIỆU
    const newCommentId = (rows && rows.length > 0) ? rows[0].id : null;
    
    if (newCommentId) {
        const getCommentSql = `
           SELECT c.*, u.full_name as user_name, r.name as user_role 
           FROM task_comments c 
           LEFT JOIN users u ON c.user_id = u.id 
           LEFT JOIN roles r ON u.role_id = r.id 
           WHERE c.id = $1
        `;
        const fullComment = await pool.query(getCommentSql, [newCommentId]);
        return res.json({ success: true, data: fullComment.rows[0] });
    } else {
        return res.status(500).json({ success: false, error: 'Không thể tạo bình luận' });
    }
  } catch (error) {
    if (error.code === '23503') {
        console.warn(`[API Comment] Cố gắng bình luận vào Task không tồn tại: task_id=${req.params.id}`);
        return res.status(404).json({ 
            success: false, 
            message: 'Task này không còn tồn tại hoặc đã bị xóa. Vui lòng làm mới trang.' 
        });
    }

    console.error('[API Comment] Lỗi 500:', error);
    return res.status(500).json({ 
        success: false, 
        message: 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.' 
    });
  }
});


// ==========================================
// NOTIFICATIONS API
// ==========================================
app.get('/api/notifications', authenticateUser, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
            [req.user.id]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi tải thông báo' });
    }
});

app.get('/api/notifications/stream', authenticateUser, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const clientId = req.user.id;
    sseClients.set(clientId, res);

    res.write(':\n\n'); // Ping

    req.on('close', () => {
        sseClients.delete(clientId);
    });
});

app.put('/api/notifications/:id/read', authenticateUser, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi cập nhật' });
    }
});

app.post('/api/tasks', authenticateUser, async (req, res) => {
    try {
      const { title, desc, pic, deadline, status, urgent, facility, department_code } = req.body;
      
      const normalizedDept = normalizeDept(department_code || facility);
      const userDept = req.user.department_code || req.user.department_id;
      
      if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'VICE_PRESIDENT') {
          if (normalizeDept(userDept) !== normalizedDept) {
              return res.status(403).json({message: "Cấm gán chéo phòng ban!"});
          }
      }
      
      let priorityStars = 0;
      if (req.user.role === 'SUPER_ADMIN') priorityStars = 3;
      else if (req.user.role === 'VICE_PRESIDENT') priorityStars = 2;

      
      let pic_id = null;
      if (pic) {
          const picUser = await pool.query('SELECT id FROM users WHERE full_name = $1 OR email = $1 LIMIT 1', [pic]);
          if (picUser.rows.length > 0) pic_id = picUser.rows[0].id;
      }
    
      let insert_facility_id = null;
      if (req.user.role === 'FACILITY_MANAGER') {
          insert_facility_id = req.user.facility_id;
      } else if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
          // FORCE OVERRIDE cho phòng ban
          let targetDept = req.user.department_id || facility;
          if (targetDept && targetDept !== 'HQ' && targetDept !== 'ALL') {
              const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [targetDept]);
              if (facRecord.rows.length > 0) {
                  insert_facility_id = facRecord.rows[0].id;
              }
          }
      } else {
          // Admin hoặc các role khác
          if (facility && facility !== 'HQ' && facility !== 'ALL') {
              let parsedFac = parseInt(facility, 10);
              if (!isNaN(parsedFac)) {
                  insert_facility_id = parsedFac;
              } else {
                  const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [facility]);
                  if (facRecord.rows.length > 0) { insert_facility_id = facRecord.rows[0].id; }
                }
            }
        }

      // FALLBACK: If insert_facility_id is still null (due to 'ALL', 'HQ', or unmapped facility name like 'DB41')
    if (!insert_facility_id || insert_facility_id === 'ALL') {
        const hqFac = await pool.query("SELECT id FROM facilities WHERE code = 'HQ' OR name = 'HQ' LIMIT 1");
        if (hqFac.rows.length > 0) {
            insert_facility_id = hqFac.rows[0].id;
        } else {
            const anyFac = await pool.query("SELECT id FROM facilities LIMIT 1");
            if (anyFac.rows.length > 0) insert_facility_id = anyFac.rows[0].id;
        }
    }

    const insertQuery = `
      INSERT INTO tasks (title, description, status, urgency, deadline, pic_id, facility_id, priority_level, department_code, priority_stars, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id, title, description as desc, status, urgency as urgent, TO_CHAR(deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, created_at as "createdAt"
    `;
      const { rows } = await pool.query(insertQuery, [
        title, 
        desc || '', 
        status || 'todo', 
        urgent || false, 
        deadline, 
        pic_id, 
        insert_facility_id, 
        urgent ? 'URGENT' : 'PRIORITY',
        normalizedDept,
        priorityStars
      ]);
    
    const newTask = {
      ...rows[0],
      pic: pic || 'Chưa gán',
      picId: pic || 'unassigned',
      facility: facility || 'HQ',
      facilityId: facility || 'HQ'
    };


      res.json({ success: true, data: newTask });
  } catch (error) {
    console.error("Lỗi chi tiết từ DB:", error.message, error.stack);
    res.status(500).json({ error: 'Lỗi server khi lưu công việc.' });
  }
});

// API Đăng nhập giả lập
app.delete('/api/system/reset', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
       return res.status(403).json({ error: 'Không đủ quyền' });
    }
    await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    await pool.query('DELETE FROM daily_logs WHERE entry_type != $1', ['SYSTEM_CONFIG']);
    await pool.query('DELETE FROM daily_financial_reports');
    res.json({ success: true, message: 'Đã dọn dẹp toàn bộ dữ liệu kiểm thử' });
  } catch (error) {
    console.error("Lỗi reset system:", error);
    res.status(500).json({ error: 'Lỗi máy chủ khi reset system' });
  }
});


app.post('/api/login', async (req, res) => {
      let { username, password } = req.body;
      
      if (username) {
        username = username.trim().toLowerCase();
      }
      
      if (username === 'admin' && password === hardcodedPasswords['admin']) {
      return res.json({
        success: true,
        token: 'mock-jwt-token-admin',
        user: { name: 'Sếp Tổng', role: 'SUPER_ADMIN', facility_id: 'ALL', username: 'admin' }
      });
    } else if (username === 'manager1' && password === hardcodedPasswords['manager1']) {
      return res.json({
        success: true,
        token: 'mock-jwt-token-manager',
        user: { name: 'Quản lý Cơ sở 1', role: 'FACILITY_MANAGER', facility_id: 'Cơ sở 1', username: 'manager1' }
      });
    } else if (username === 'sysadmin' && password === hardcodedPasswords['sysadmin']) {
      return res.json({
        success: true,
        token: 'mock-jwt-token-sysadmin',
        user: { name: 'Quản trị viên Hệ thống (IT)', role: 'ADMIN', facility_id: 'ALL', username: 'sysadmin' }
      });
    }
  
    try {
        const { rows } = await pool.query(`
            SELECT u.*, r.name AS role_name, f.code AS facility_code, f.name AS facility_name 
            FROM users u 
            LEFT JOIN roles r ON u.role_id = r.id 
            LEFT JOIN facilities f ON u.facility_id = f.id
            WHERE u.email = $1 OR u.full_name = $1
        `, [username]);
        if (rows.length > 0) {
            const user = rows[0];
            
            if (user.status !== 'ACTIVE') {
              return res.status(403).json({ success: false, error: 'Tài khoản đã bị khóa.' });
            }
            
            const isMatch = await bcrypt.compare(password, user.password_hash || '');
            const passToCheck = user.password || user.password_hash;
            
            if (isMatch || passToCheck === password || passToCheck === Buffer.from(password).toString('base64') || Buffer.from(passToCheck || '').toString('base64') === password) {
                const tokenPayload = {
                    id: user.id,
                    role: user.role_name,
                    facility_id: user.managed_facilities || user.facility_name || 'ALL',
                    facility_code: user.facility_code || '',
                    department_id: user.department_id || null
                };
                return res.json({
                    success: true,
                    token: jwt.sign(tokenPayload, SECRET_KEY, { expiresIn: '7d' }),
                    user: { 
                        name: user.full_name, 
                        role: user.role_name, 
                        facility_id: tokenPayload.facility_id,
                        facility_code: tokenPayload.facility_code,
                        username: user.email || user.full_name
                    }
                });
            } else {
                console.error("Sai mật khẩu cho user:", username);
            }
        }
    } catch (e) {
        console.error("Lỗi đăng nhập DB:", e);
    }

    console.error("Lỗi 401: Không tìm thấy tài khoản hoặc mật khẩu không khớp. Payload:", req.body);
    return res.status(401).json({ success: false, error: 'Tài khoản hoặc mật khẩu không chính xác.' });
});

// ==============================================================================
// 1.5. API DAILY CHECK-IN (BÁO CÁO ĐẦU GIỜ)
// ==============================================================================

// POST /api/checkin was removed because it is now handled by POST /api/logs

app.get('/api/checkin/status', authenticateUser, async (req, res) => {
  try {
    const todayStr = new Date().toLocaleDateString('vi-VN');
    const { role, facility_id } = req.user;
    
    // Get facilities
    let targetFacilities = [];
    if (role === 'FACILITY_MANAGER') {
       targetFacilities = [facility_id];
    } else {
       const facRes = await pool.query("SELECT name FROM facilities WHERE status = 'ACTIVE'");
       targetFacilities = facRes.rows.map(r => r.name);
    }
    
    const { rows } = await pool.query('SELECT * FROM daily_logs WHERE entry_type = $1 AND date = $2', ['Attendance', todayStr]);
    
    const statusList = targetFacilities.map(fac => {
      const checkins = rows.filter(c => c.org_unit === fac);
      const ca1 = checkins.find(c => c.content && c.content.shift && c.content.shift.includes('Ca 1'));
      const calo = checkins.find(c => c.content && c.content.shift && c.content.shift.includes('Ca Lỡ'));
      const ca2 = checkins.find(c => c.content && c.content.shift && c.content.shift.includes('Ca 2'));
      return {
        facility_id: fac,
        ca1: ca1 ? `Đã báo cáo lúc ${ca1.display_time}` : 'Chưa báo cáo',
        calo: calo ? `Đã báo cáo lúc ${calo.display_time}` : 'Chưa báo cáo',
        ca2: ca2 ? `Đã báo cáo lúc ${ca2.display_time}` : 'Chưa báo cáo',
        details: checkins
      };
    });

    res.json({ success: true, data: statusList });
  } catch (error) {
    res.status(500).json({ error: `Lỗi server: ${error.message}` });
  }
});

// ==============================================================================
// 2. AUTO-TASKING AI (TÍCH HỢP OPENROUTER)
// ==============================================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-v1-xxxxxxxxxxxx'; 

app.post('/api/ai/auto-tasking', authenticateUser, async (req, res) => {
  try {
    const { meetingTranscript, facilityId } = req.body;

    if (!meetingTranscript) {
      return res.status(400).json({ error: 'Vui lòng cung cấp biên bản cuộc họp.' });
    }

    const systemPrompt = `Bạn là một AI điều phối Công việc xuất sắc. Nhiệm vụ: Đọc biên bản cuộc họp và tự động trích xuất các công việc cần làm thành định dạng JSON strict.
Trích xuất mảng "tasks" với cấu trúc: "task_title", "pic", "deadline" (YYYY-MM-DDTHH:mm, mặc định 17:00 nếu không có giờ), "target_facility" (Tên cơ sở, ví dụ: Cơ sở 1), "priority_level" (Quét văn bản: Nếu có 'khẩn cấp', 'gấp', 'ngay', 'hỏa tốc' -> 'URGENT'. Nếu không -> 'PRIORITY').`;

    const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
    const aiConfig = configRows.length > 0 ? configRows[0].data : {};
    const aiModel = aiConfig.model || "google/gemini-2.5-flash";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModel,
        messages: [ { role: "system", content: systemPrompt }, { role: "user", content: meetingTranscript } ],
        response_format: { type: "json_object" }
      })
    });

    const aiData = await response.json();
    let extractedTasks = [];

    if (aiData.choices && aiData.choices.length > 0) {
      try {
        extractedTasks = JSON.parse(aiData.choices[0].message.content);
        if (extractedTasks.tasks) extractedTasks = extractedTasks.tasks;
        if (Array.isArray(extractedTasks)) {
            for (let t of extractedTasks) {
               let mappedFacilityId = facilityId;
               if (t.target_facility) {
                   const { rows } = await pool.query('SELECT id FROM facilities WHERE name ILIKE $1 LIMIT 1', [`%${t.target_facility}%`]);
                   if (rows.length > 0) {
                       mappedFacilityId = rows[0].id;
                   }
               }
               t.facility_id = mappedFacilityId;
               t.priority_level = t.priority_level === 'URGENT' ? 'URGENT' : 'PRIORITY';
               t.created_by_role = req.user.role;
            }
        }
      } catch (e) {
        console.error("AI không trả về JSON hợp lệ");
      }
    }

    res.json({ success: true, message: 'Trích xuất Auto-Tasking thành công.', data: extractedTasks });

  } catch (error) {
    res.status(500).json({ error: 'Lỗi khi gọi AI API.' });
  }
});

// ==============================================================================
// 2.5. AI REVENUE EXTRACTION (PROXY CHO FRONTEND ĐỂ TRÁNH CORS)
// ==============================================================================

app.post('/api/internal/extract-revenue', express.json({limit: '50mb'}), async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ error: 'Thiếu dữ liệu hình ảnh (Base64).' });
    }

    const systemPrompt = `Đây là bảng doanh thu. Cột 1 là Thứ, Cột 2 là Ngày. Các cột tiếp theo là Doanh thu của DB41, ACE, PQ, PA, PAV, DB01. Hãy bỏ qua các hàng tiêu đề. Đọc từ hàng có chứa ngày tháng. Trả về mảng JSON: [{"date": "DD/MM/YYYY", "revenues": {"DUBAI 41": 100000, "DUBAI ACE": 200000, "DUBAI PHÚ QUỐC": 300000, "DUBAI PA": 400000, "DUBAI PAV": 500000, "DUBAI PAK": 600000}}]`;

    const payload = {
      model: "anthropic/claude-3.5-sonnet",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: systemPrompt },
            { type: "image_url", image_url: { url: imageBase64 } }
          ]
        }
      ]
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`, 
        "Content-Type": "application/json",
        "HTTP-Referer": "https://taskflow-ai-dashboard.onrender.com",
        "X-Title": "Stitch Smart AI"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter Response Error:", errText);
      return res.status(response.status).json({ error: 'Lỗi từ OpenRouter API.' });
    }

    const aiData = await response.json();
    let parsedData = [];
    
    if (aiData.choices && aiData.choices.length > 0) {
      const aiText = aiData.choices[0].message.content;
      const jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
         return res.status(500).json({ error: 'AI không trả về JSON hợp lệ.' });
      }
    }

    res.json({ success: true, data: parsedData });

  } catch (error) {
    console.error('Lỗi khi gọi AI Extract API:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ khi gọi AI API.' });
  }
});

app.post('/api/internal/extract-revenue-text', authenticateUser, async (req, res) => {
  try {
    const { prompt, content } = req.body;
    
    if (!prompt || !content) {
      return res.status(400).json({ error: 'Thiếu dữ liệu prompt hoặc nội dung.' });
    }

    const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
    const aiConfig = configRows.length > 0 ? configRows[0].data : {};
    const aiModel = aiConfig.model || "google/gemini-2.5-flash";

    const payload = {
      model: aiModel,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: content }
      ],
      response_format: { type: "json_object" }
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`, 
        "Content-Type": "application/json",
        "HTTP-Referer": "https://taskflow-ai-dashboard.onrender.com",
        "X-Title": "Stitch Smart AI"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter Response Error:", errText);
      return res.status(response.status).json({ error: 'Lỗi từ OpenRouter API.' });
    }

    const aiData = await response.json();
    let parsedData = [];
    
    if (aiData.choices && aiData.choices.length > 0) {
      const aiText = aiData.choices[0].message.content;
      const jsonMatch = aiText.match(/\[[\s\S]*\]/) || aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
        if (parsedData.data) parsedData = parsedData.data;
        if (!Array.isArray(parsedData)) parsedData = [parsedData];
      } else {
         return res.status(500).json({ error: 'AI không trả về JSON hợp lệ.' });
      }
    }

    // Trả về usage token để frontend log
    res.json({ success: true, data: parsedData, usage: aiData.usage });

  } catch (error) {
    console.error('Lỗi khi gọi AI Extract API (Text):', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ khi gọi AI API.' });
  }
});

// ==============================================================================
// 3. AI PING THẤU CẢM (EMPATHETIC PING) & TONE ESCALATION
// ==============================================================================

// Hàm tính toán mức độ trễ hạn (Tone Escalation)
const calculateTone = (deadlineDateStr) => {
  const deadline = new Date(deadlineDateStr);
  const today = new Date('2026-05-14T00:00:00Z'); // Lấy mốc thời gian hiện tại theo context
  
  // Tính độ chênh lệch số ngày
  const diffTime = deadline - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

  if (diffDays > 1) {
    return {
      level: 'Hỗ trợ',
      guidance: 'Thể hiện sự quan tâm tinh tế, hỏi thăm xem PIC có gặp khó khăn hay thiếu nguồn lực nào không để kịp deadline.'
    };
  } else if (diffDays === 0 || diffDays === 1) {
    return {
      level: 'Pre-deadline',
      guidance: 'Tông giọng Khích lệ & Chuẩn bị. Hỏi thăm xem bạn đã sẵn sàng nghiệm thu chưa. Ví dụ: "Ngày mai là hạn chốt, bạn đã sẵn sàng nghiệm thu chưa?"'
    };
  } else if (diffDays < 0 && diffDays >= -3) {
    return {
      level: 'Nhắc nhở chuyên nghiệp',
      guidance: 'Nhắc nhở lịch sự nhưng kiên quyết. Yêu cầu cập nhật tình hình hiện tại và đưa ra cam kết hoàn thành.'
    };
  } else {
    return {
      level: 'Cảnh báo kỷ luật',
      guidance: 'Giọng điệu nghiêm túc, quyết liệt. Nhấn mạnh việc đã trễ hạn quá lâu, yêu cầu báo cáo nguyên nhân gốc rễ và giải trình lên cấp quản lý ngay lập tức.'
    };
  }
};

  // API: Lịch sử hội thoại AI toàn cầu (Global Memory)
  app.get('/api/ai/sessions', authenticateUser, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM ai_chat_sessions ORDER BY timestamp DESC LIMIT 50');
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai/sessions', authenticateUser, async (req, res) => {
    try {
      const { id, user_id, facility, title, chat_log, timestamp } = req.body;
      await pool.query(
        `INSERT INTO ai_chat_sessions (id, user_id, facility, title, chat_log, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET 
         chat_log = EXCLUDED.chat_log, 
         timestamp = EXCLUDED.timestamp,
         title = EXCLUDED.title`,
        [id, user_id, facility, title, JSON.stringify(chat_log || []), timestamp]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

// API: Lưu và lấy danh sách vi phạm AI
app.get('/api/ai/violations', authenticateUser, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM system_config WHERE key = $1', ['ai_violations']);
    let violations = [];
    if (rows.length > 0 && rows[0].data) {
       violations = rows[0].data;
    }
    res.json({ success: true, data: violations });
  } catch (error) {
    console.error('Lỗi lấy AI violations:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/api/ai/violations', authenticateUser, async (req, res) => {
  try {
    const violation = req.body;
    const { rows } = await pool.query('SELECT data FROM system_config WHERE key = $1', ['ai_violations']);
    let violations = [];
    if (rows.length > 0 && rows[0].data) {
       violations = Array.isArray(rows[0].data) ? rows[0].data : [];
    }
    violations.unshift(violation);
    if (violations.length > 200) violations = violations.slice(0, 200); // limit to 200 latest

    await pool.query(`
        INSERT INTO system_config (key, data, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
    `, ['ai_violations', JSON.stringify(violations)]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Lỗi lưu AI violations:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API: Kích hoạt AI Ping đôn đốc công việc
app.post('/api/ai/ping', authenticateUser, async (req, res) => {
  try {
    const { taskId } = req.body;
    const task = mockTasks.find(t => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: 'Không tìm thấy công việc.' });
    }

    // 1. Tính toán Tone nhắc việc dựa trên Deadline
    const toneEscalation = calculateTone(task.deadline);

    // 2. Gọi OpenRouter để sinh nội dung nhắc việc thấu cảm theo Tone đã tính
    const systemPrompt = `
      Bạn là một Trợ lý AI Cố vấn (AI Executive Advisor) trong hệ thống TaskFlow AI. 
      Bạn đang thực hiện tính năng "Đôn đốc Thấu cảm" (Empathetic Ping) nhằm tạo áp lực tiến độ một cách tinh tế.
      
      Thông tin công việc:
      - Tên công việc: "${task.title}"
      - Người phụ trách (PIC): ${task.pic_name}
      - Hạn chót: ${task.deadline}
      - Mức độ cảnh báo (Tone Escalation): ${toneEscalation.level}
      - Định hướng giọng điệu: ${toneEscalation.guidance}

      Nhiệm vụ: Viết một tin nhắn ngắn gọn (dưới 50 chữ), xưng hô lịch sự với ${task.pic_name}.
      Đúng chuẩn mức độ cảnh báo được yêu cầu. Không thêm lời chào thừa thãi như "Chào bạn", đi thẳng vào vấn đề theo cách thấu cảm.
    `;

    const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
    const aiConfig = configRows.length > 0 ? configRows[0].data : {};
    const aiModel = aiConfig.model || "google/gemini-2.5-flash";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt }
        ]
      })
    });

    const aiData = await response.json();
    let pingMessage = "Đã xảy ra lỗi sinh nội dung nhắc việc.";
    
    if (aiData.choices && aiData.choices.length > 0) {
      pingMessage = aiData.choices[0].message.content.trim();
    }

    // 3. Ghi vào "Bảng Log Nhắc việc AI" công khai
    await pool.query('INSERT INTO ai_ping_logs (task_id, message) VALUES ($1, $2)', [task.id, pingMessage]);
    const logEntry = {
      task_id: task.id,
      message: pingMessage,
      created_at: new Date().toISOString()
    };

    res.json({
      success: true,
      message: 'Đã gửi AI Ping thành công.',
      data: {
        tone_escalation: toneEscalation.level,
        generated_message: pingMessage,
        log: logEntry
      }
    });

  } catch (error) {
    console.error('Lỗi khi gọi AI Ping:', error);
    res.status(500).json({ error: 'Lỗi khi gọi AI API.' });
  }
});

// ==============================================================================
// 4. BÁO CÁO THỐNG KÊ TOKEN (DB VẬT LÝ)
// ==============================================================================

app.post('/api/internal/log-tokens', authenticateUser, async (req, res) => {
  try {
    const { username, prompt_tokens, completion_tokens, total_tokens } = req.body;
    const query = `
      INSERT INTO ai_token_usage_logs (user_id, username, prompt_tokens, completion_tokens, total_tokens)
      VALUES ($1, $2, $3, $4, $5)
    `;
    // user.id is not available in mock token, so we rely on headers, assuming req.user.id is passed or handled.
    // In our auth middleware, we only set req.user = { role, facility_id }. Let's assume we map it.
    await pool.query(query, [null, username, prompt_tokens, completion_tokens, total_tokens]);
    res.json({ success: true });
  } catch (error) {
    console.error('Lỗi lưu log token:', error);
    res.status(500).json({ error: 'Lỗi server khi lưu token.' });
  }
});

app.get('/api/internal/ai-token-stats', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Quyền truy cập bị từ chối. Bạn không có quyền truy cập dữ liệu hệ thống.' });
    }

    const limit = parseInt(req.query.limit) || 5;
    const query = `
      SELECT username, SUM(total_tokens) as total_tokens
      FROM ai_token_usage_logs
      GROUP BY username
      ORDER BY total_tokens DESC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    res.json({ success: true, top_users: result.rows });
  } catch (error) {
    console.error('Lỗi truy xuất thống kê token:', error);
    res.status(500).json({ error: 'Lỗi kết nối cơ sở dữ liệu vật lý.' });
  }
});

// ==============================================================================
// 5. DAILY FINANCIAL REPORTS (POSTGRESQL)
// ==============================================================================

app.get('/api/reports', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'FACILITY_MANAGER'].includes(role)) {
      return res.status(403).json({ error: 'Không đủ quyền xem báo cáo tài chính.' });
    }
    const { rows } = await pool.query('SELECT * FROM daily_financial_reports ORDER BY date DESC');
    const mappedRows = rows.map(r => ({
      ...r,
      totalRevenue: Number(r.total_revenue),
      createdBy: r.created_by,
      timestamp: Number(r.timestamp)
    }));
    res.json({ success: true, data: mappedRows });
  } catch (error) {
    console.error('Lỗi lấy báo cáo doanh thu:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy doanh thu.' });
  }
});

app.post('/api/reports', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'FINANCE_DEPT' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Không đủ quyền lưu báo cáo.' });
    }
    
    const isArray = Array.isArray(req.body);
    const reports = isArray ? req.body : [req.body];
    
    const query = `
      INSERT INTO daily_financial_reports (id, date, total_revenue, data, created_by, timestamp, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (date) DO UPDATE 
      SET total_revenue = EXCLUDED.total_revenue,
          data = EXCLUDED.data,
          created_by = EXCLUDED.created_by,
          timestamp = EXCLUDED.timestamp,
          updated_at = NOW()
      RETURNING *
    `;
    
    const results = [];
    for (const report of reports) {
      const { id, date, totalRevenue, data, createdBy, timestamp } = report;
      const { rows } = await pool.query(query, [id, date, totalRevenue, JSON.stringify(data), createdBy, timestamp]);
      results.push(rows[0]);
    }
    
    res.json({ success: true, data: isArray ? results : results[0] });
  } catch (error) {
    console.error('Lỗi lưu báo cáo doanh thu:', error);
    res.status(500).json({ error: 'Lỗi server khi lưu báo cáo doanh thu.' });
  }
});

// ==============================================================================
// 6. KPI SETTINGS
// ==============================================================================

app.get('/api/kpi', authenticateUser, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM kpi_settings ORDER BY updated_at DESC LIMIT 1');
    if (rows.length > 0) {
      res.json({ success: true, data: rows[0] });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    console.error('Lỗi lấy KPI:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy KPI.' });
  }
});

app.post('/api/kpi', authenticateUser, async (req, res) => {
  try {
    const { role, name, username } = req.user;
    if (!['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'FINANCE_DEPT'].includes(role)) {
      return res.status(403).json({ error: 'Không đủ quyền lưu cấu hình KPI.' });
    }
    
    const { apply_month, data } = req.body;
    
    // UPSERT by apply_month or just keep adding new rows and fetch latest
    const query = `
      INSERT INTO kpi_settings (id, apply_month, data, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE 
      SET apply_month = EXCLUDED.apply_month,
          data = EXCLUDED.data,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      RETURNING *
    `;
    
    // We use a constant ID for now or unique month
    const id = apply_month ? `kpi_${apply_month.replace('/', '_')}` : 'kpi_default';
    const updatedBy = name || username || role;
    
    const { rows } = await pool.query(query, [id, apply_month, JSON.stringify(data), updatedBy]);
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Lỗi lưu cấu hình KPI:', error);
    res.status(500).json({ error: 'Lỗi server khi lưu cấu hình KPI.' });
  }
});

// ==============================================================================
// SYSTEM CONFIG API
// ==============================================================================
app.get('/api/config', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM system_config');
    const configData = {};
    rows.forEach(row => { configData[row.key] = row.data; });
    res.json({ success: true, data: configData });
  } catch (error) {
    console.error('Lỗi tải system config:', error);
    res.status(500).json({ error: 'Lỗi server khi tải cấu hình.' });
  }
});

app.post('/api/config', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user || {};
    if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
       return res.status(403).json({ error: 'Không có quyền lưu cấu hình hệ thống.' });
    }
    
    const { ai_config, system_prompts } = req.body;
    
    if (ai_config) {
      await pool.query(`
        INSERT INTO system_config (key, data, updated_at) 
        VALUES ($1, $2, NOW()) 
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `, ['taskflow_ai_config', JSON.stringify(ai_config)]);
    }
    
    if (system_prompts) {
      await pool.query(`
        INSERT INTO system_config (key, data, updated_at) 
        VALUES ($1, $2, NOW()) 
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `, ['taskflow_system_prompts', JSON.stringify(system_prompts)]);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Lỗi lưu system config:', error);
    res.status(500).json({ error: 'Lỗi server khi lưu cấu hình hệ thống.' });
  }
});


// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 TaskFlow AI Server đang chạy tại http://localhost:${PORT}`);
  console.log(`[DB] DATABASE_URL: ${process.env.DATABASE_URL ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_HOST: ${process.env.DB_HOST ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_NAME: ${process.env.DB_NAME ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_USER: ${process.env.DB_USER ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_PORT: ${process.env.DB_PORT ? 'OK' : 'UNDEFINED'}`);
  console.log(`[API] SUPABASE_KEY: ${process.env.SUPABASE_KEY ? 'OK' : 'UNDEFINED'}`);
});

