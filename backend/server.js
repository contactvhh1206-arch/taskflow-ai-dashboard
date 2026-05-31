import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET || 'HubDB_Global_Temp_Secret_2026_!!!';
import cors from 'cors';
import fetch from 'node-fetch'; 
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import multer from 'multer';

dotenv.config();

const normalizeDept = (code) => {
    if (!code) return '';
    let normalized = code.toString().trim().toUpperCase();
    normalized = normalized.replace(/^PHÃ’NG\s+/i, '').replace(/^PHONG\s+/i, '');
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

// HÃ€M PHÃ‚N QUYá»€N SSE BROADCAST
async function sendRealtimeNotification(taskId, type, message, actorId = null) {
    if (!taskId) return;
    try {
        const taskCheck = await pool.query('SELECT facility_id, department_code FROM tasks WHERE id = $1', [taskId]);
        if (taskCheck.rows.length === 0) return;
        const task = taskCheck.rows[0];

        // Láº¥y danh sÃ¡ch User há»£p lá»‡ (Sáº¿p tá»•ng/phÃ³ HOáº¶C trÃ¹ng facility_id/department_code)
        const usersRes = await pool.query(`
            SELECT u.id 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE r.name IN ('SUPER_ADMIN', 'VICE_PRESIDENT')
               OR (u.facility_id = $1 AND $1 IS NOT NULL)
               OR (u.department_code = $2 AND $2 IS NOT NULL)
               OR (u.department_id = $2 AND $2 IS NOT NULL)
        `, [task.facility_id, task.department_code]);
        
        const allowedUserIds = usersRes.rows.map(r => r.id);
        
        for (const uid of allowedUserIds) {
            // LÆ°u DB Notifications
            const notifRes = await pool.query(`
                INSERT INTO notifications (user_id, task_id, type, message, actor_id)
                VALUES ($1, $2, $3, $4, $5) RETURNING *
            `, [uid, taskId, type, message, actorId]);
            const newNotif = notifRes.rows[0];

            // Báº¯n SSE an toÃ n Ä‘Ãºng kÃªnh
            if (sseClients.has(parseInt(uid))) {
                sseClients.get(parseInt(uid)).write(`data: ${JSON.stringify(newNotif)}\n\n`);
            } else if (sseClients.has(String(uid))) {
                sseClients.get(String(uid)).write(`data: ${JSON.stringify(newNotif)}\n\n`);
            }
        }
    } catch (e) {
        console.error("Error saving/sending secure notification:", e);
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

    // =========================================
    // MIGRATION BẢNG AI CHAT MESSAGES & SESSIONS
    // =========================================
    try {
      await pool.query(`ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_chat_messages (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
          role VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          tool_calls JSONB DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages(session_id, created_at ASC);`);
      console.log('Migration Success: ai_chat_messages & metadata applied.');
    } catch (error) {
      console.error('Migration Failed for AI Chat Memory:', error);
    }
    
    // =========================================
    // KÃCH HOáº T VECTOR VÃ€ Báº¢NG RAG (KNOWLEDGE BASE)
    // =========================================
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Dá»n dáº¹p DB theo lá»‡nh CTO
    try {
        await pool.query(`DROP TABLE IF EXISTS ai_token_usage_logs CASCADE`);
    } catch (e) { console.error(e); }
    try {
        await pool.query(`
            ALTER TABLE ai_ping_logs 
            ADD COLUMN prompt_tokens INT DEFAULT 0,
            ADD COLUMN completion_tokens INT DEFAULT 0
        `);
    try {
        await pool.query(`
            ALTER TABLE ai_ping_logs 
            ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id),
            ADD COLUMN IF NOT EXISTS facility_id INT REFERENCES facilities(id),
            ADD COLUMN IF NOT EXISTS total_tokens INT DEFAULT 0
        `);
    } catch (e) {}

    } catch (e) {
        // Ignore if columns already exist
    }

    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS company_knowledge_base (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            embedding vector(1536),
            source_type VARCHAR(50),
            metadata JSONB,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await pool.query(`
        CREATE INDEX IF NOT EXISTS company_knowledge_vector_idx 
        ON company_knowledge_base USING hnsw (embedding vector_cosine_ops)
    `);
    
    await pool.query(`
        CREATE INDEX IF NOT EXISTS company_knowledge_metadata_gin_idx 
        ON company_knowledge_base USING gin (metadata)
    `);
    
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_department_code ON tasks USING btree (department_code);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks USING btree (created_by);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_pic_id ON tasks USING btree (pic_id);`);
    
    // YÃªu cáº§u báº¯t buá»™c: Bá»• sung is_deleted cho facilities
    await pool.query(`ALTER TABLE facilities ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;`);
    
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
// 1. MOCK DATABASE & MIDDLEWARE PHÃ‚N QUYá»€N (RBAC)
// ==============================================================================



// ==============================================================================
// DAILY LOGS API
// ==============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM daily_logs ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ error: `Lá»—i server: ${error.message}` });
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
    res.status(500).json({ error: `Lá»—i server: ${error.message}` });
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
    res.status(500).json({ error: 'Lá»—i server khi láº¥y danh sÃ¡ch cÆ¡ sá»Ÿ' });
  }
});

app.post('/api/facilities', async (req, res) => {
  try {
    const { name, address, code } = req.body;
    if (!name) return res.status(400).json({ error: 'TÃªn cÆ¡ sá»Ÿ khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng.' });
    
    let facCode = code || name.replace(/\s+/g, '').toUpperCase();
    const { rows } = await pool.query(
      `INSERT INTO facilities (name, code, status) VALUES ($1, $2, 'ACTIVE') RETURNING *`, 
      [name.trim(), facCode]
    );
    res.json({ success: true, data: { ...rows[0], is_active: true } });
  } catch (error) {
    res.status(500).json({ error: 'Lá»—i khi táº¡o cÆ¡ sá»Ÿ (cÃ³ thá»ƒ trÃ¹ng mÃ£).' });
  }
});

app.put('/api/facilities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, pic } = req.body;
    
    // First check if the facility exists
    const checkRes = await pool.query('SELECT * FROM facilities WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÆ¡ sá»Ÿ.' });

    // Update facility
    const { rows } = await pool.query(
      `UPDATE facilities SET name = $1, address = $2, pic = $3 WHERE id = $4 RETURNING *`,
      [name, address, pic, id]
    );
    res.json({ success: true, data: { ...rows[0], is_active: rows[0].status === 'ACTIVE' } });
  } catch (error) {
    console.error('Update facility error:', error);
    res.status(500).json({ error: 'Lá»—i server khi cáº­p nháº­t cÆ¡ sá»Ÿ.' });
  }
});

app.put('/api/facilities/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`UPDATE facilities SET status = 'INACTIVE' WHERE id = $1 RETURNING *`, [id]);
    if(rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÆ¡ sá»Ÿ.' });
    res.json({ success: true, data: { ...rows[0], is_active: false } });
  } catch (error) {
    res.status(500).json({ error: 'Lá»—i server' });
  }
});

app.put('/api/facilities/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`UPDATE facilities SET status = 'ACTIVE' WHERE id = $1 RETURNING *`, [id]);
    if(rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÆ¡ sá»Ÿ.' });
    res.json({ success: true, data: { ...rows[0], is_active: true } });
  } catch (error) {
    res.status(500).json({ error: 'Lá»—i server' });
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
        let departmentCode = null;
        let facilityCode = null;

        try {
            const payload = jwt.verify(token, SECRET_KEY);
            userId = payload.id;
            userRole = payload.role;
            facilityRaw = payload.facility_id;
            departmentId = payload.department_id;
            departmentCode = payload.department_code;
            facilityCode = payload.facility_code;
        } catch (jwtErr) {
            console.error('[Auth Middleware] Lỗi giải mã Token:', jwtErr.message);
            return res.status(401).json({ success: false, message: 'Invalid or Expired Token' });
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
      
        req.user = { id: userId, role: userRole, facility_id: facilityId, department_id: departmentId, department_code: departmentCode, facility_code: facilityCode };
        next();
    } catch (err) {
        console.error("Auth middleware error:", err);
        return res.status(500).json({ error: 'Lá»—i xÃ¡c thá»±c ná»™i bá»™.' });
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
    res.status(500).json({ error: 'Lá»—i láº¥y danh sÃ¡ch vai trÃ²' });
  }
});


const checkAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: "403 Forbidden: Quyá»n lá»±c nÃ y chá»‰ dÃ nh cho Káº» GÃ¡c Äá»n (ADMIN)!" });
    }
    next();
};

app.get('/api/users/directory', authenticateUser, async (req, res) => {
  try {
    const { rows: users } = await pool.query('SELECT id AS user_id, email, full_name, role_id, facility_id FROM users');
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Lá»—i láº¥y danh báº¡:", error);
    res.status(500).json({ error: 'Lá»—i server.' });
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
    res.status(500).json({ error: 'Lá»—i láº¥y danh sÃ¡ch ngÆ°á»i dÃ¹ng' });
  }
});

app.post('/api/users', authenticateUser, checkAdmin, async (req, res) => {
  try {
    const { username, password, name, role, facility_id } = req.body;
    
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password.trim(), salt);
    
    const roleRes = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    if (roleRes.rows.length === 0) return res.status(400).json({ error: 'Vai trÃ² khÃ´ng há»£p lá»‡.' });
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
    console.error("Lá»—i táº¡o user:", error);
    res.status(500).json({ error: 'Lá»—i táº¡o tÃ i khoáº£n (cÃ³ thá»ƒ username Ä‘Ã£ tá»“n táº¡i).' });
  }
});

app.put('/api/users/change-password', authenticateUser, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    
    
    // Find user in DB
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1 OR full_name = $1`, [username]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y thÃ´ng tin tÃ i khoáº£n.' });
    }
    
    const user = rows[0];
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash || '');
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
    }
    
    // Update new password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    
    res.json({ success: true, message: 'Äá»•i máº­t kháº©u thÃ nh cÃ´ng.' });
  } catch (error) {
    console.error("Lá»—i Ä‘á»•i máº­t kháº©u:", error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ khi Ä‘á»•i máº­t kháº©u.' });
  }
});

app.put('/api/users/:id', authenticateUser, checkAdmin, async (req, res) => {
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
    console.error("Lá»—i cáº­p nháº­t user:", error);
    res.status(500).json({ error: 'Lá»—i cáº­p nháº­t tÃ i khoáº£n.' });
  }
});

app.delete('/api/users/:id', authenticateUser, checkAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'KhÃ´ng thá»ƒ xÃ³a user vÃ¬ Ä‘ang cÃ³ dá»¯ liá»‡u cÃ´ng viá»‡c liÃªn quan.' });
  }
});

const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'];

app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const { role, facility_id, department_code, department_id, id } = req.user;
    
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
      LEFT JOIN facilities f ON t.facility_id = f.id AND f.is_deleted = false
      LEFT JOIN task_comments tc ON t.id = tc.task_id
      WHERE 1=1
    `;
    const params = [];
    const userDept = normalizeDept(department_code || department_id);

    if (ALL_ACCESS_ROLES.includes(role)) {
        // Nhóm All-Access: Không áp dụng điều kiện lọc bổ sung
    } else {
        // Nhóm Local: Áp dụng chung cho FACILITY_MANAGER, LOCAL...
        params.push(department_code, id, id);
        query += ` AND (t.department_code = $${params.length - 2} OR t.created_by = $${params.length - 1} OR t.pic_id = $${params.length})`;
    }
      
    query += ` GROUP BY t.id, u.full_name, u.email, f.name, f.code ORDER BY t.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Lá»—i chi tiáº¿t tá»« DB:", error.message, error.stack);
    res.status(500).json({ error: 'Lá»—i server.' });
  }
});

app.put('/api/tasks/:id/status', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, evidence } = req.body;

    // TÆ°á»ng lá»­a chá»‘ng IDOR
    const taskCheck = await pool.query('SELECT facility_id, department_code FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    const task = taskCheck.rows[0];
    
    if (req.user.role === 'FACILITY_MANAGER' && task.facility_id !== req.user.facility_id) {
        return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a cÆ¡ sá»Ÿ khÃ¡c!' });
    }
    if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
        const userDept = normalizeDept(req.user.department_code || req.user.department_id);
        if (task.department_code !== userDept) {
            return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a phÃ²ng ban khÃ¡c!' });
        }
    }

    
    const updateQuery = `
      UPDATE tasks 
      SET status = $1, 
          updated_at = NOW() 
      WHERE id = $2 
      RETURNING id, title, description as desc, status, urgency as urgent, TO_CHAR(deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, created_at as "createdAt"
    `;
    const { rows } = await pool.query(updateQuery, [status, id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    }
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Lá»—i cáº­p nháº­t tráº¡ng thÃ¡i:", error);
    res.status(500).json({ error: 'Lá»—i server khi cáº­p nháº­t tráº¡ng thÃ¡i.' });
  }
});

app.put('/api/tasks/:id/support', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    // TÆ°á»ng lá»­a chá»‘ng IDOR
    const taskCheck = await pool.query('SELECT facility_id, department_code FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    const task = taskCheck.rows[0];
    
    if (req.user.role === 'FACILITY_MANAGER' && task.facility_id !== req.user.facility_id) {
        return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a cÆ¡ sá»Ÿ khÃ¡c!' });
    }
    if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
        const userDept = normalizeDept(req.user.department_code || req.user.department_id);
        if (task.department_code !== userDept) {
            return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a phÃ²ng ban khÃ¡c!' });
        }
    }

    const updateQuery = `
      UPDATE tasks 
      SET needs_support = true, 
          updated_at = NOW() 
      WHERE id = $1 
      RETURNING id, title, needs_support as "needsSupport"
    `;
    const { rows } = await pool.query(updateQuery, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    }

    res.json({ success: true, message: 'ÄÃ£ gá»­i yÃªu cáº§u há»— trá»£ Ä‘áº¿n Ban GiÃ¡m Äá»‘c', data: rows[0] });
  } catch (error) {
    console.error("Lá»—i server khi yÃªu cáº§u há»— trá»£:", error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ ná»™i bá»™' });
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
    console.error("[API GET Comment] Lá»—i 500:", err);
    res.status(500).json({ success: false, error: 'Lá»—i táº£i bÃ¬nh luáº­n: ' + err.message });
  }
});

app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const comment = req.body.comment || req.body.content;

    // TÆ°á»ng lá»­a chá»‘ng IDOR
    const taskCheck = await pool.query('SELECT facility_id, department_code FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    const task = taskCheck.rows[0];
    
    if (req.user.role === 'FACILITY_MANAGER' && task.facility_id !== req.user.facility_id) {
        return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a cÆ¡ sá»Ÿ khÃ¡c!' });
    }
    if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
        const userDept = normalizeDept(req.user.department_code || req.user.department_id);
        if (task.department_code !== userDept) {
            return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a phÃ²ng ban khÃ¡c!' });
        }
    }

    if (!comment) return res.status(400).json({ error: 'Ná»™i dung bÃ¬nh luáº­n trá»‘ng' });

    // 1. LẤY USER_ID TỪ TOKEN, KHÔNG CHÂM CHƯỚC
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: '401 Unauthorized: Không thể xác định danh tính. Vui lòng đăng nhập lại!' });
    }
    const realUserId = req.user.id;

    // 2. THỰC THI INSERT (LÃºc nÃ y realUserId Ä‘Ã£ Ä‘Æ°á»£c Ä‘áº£m báº£o 100% lÃ  an toÃ n)
    const { rows } = await pool.query(`
      INSERT INTO task_comments (task_id, user_id, content)
      VALUES ($1, $2, $3) RETURNING *
    `, [id, realUserId, comment]);
    


        // 4. KHá»žI Táº O BIáº¾N TRáº¢ Vá»€ Tá»ª CÆ  Sá»ž Dá»® LIá»†U
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
        return res.status(500).json({ success: false, error: 'KhÃ´ng thá»ƒ táº¡o bÃ¬nh luáº­n' });
    }
  } catch (error) {
    if (error.code === '23503') {
        console.warn(`[API Comment] Cá»‘ gáº¯ng bÃ¬nh luáº­n vÃ o Task khÃ´ng tá»“n táº¡i: task_id=${req.params.id}`);
        return res.status(404).json({ 
            success: false, 
            message: 'Task nÃ y khÃ´ng cÃ²n tá»“n táº¡i hoáº·c Ä‘Ã£ bá»‹ xÃ³a. Vui lÃ²ng lÃ m má»›i trang.' 
        });
    }

    console.error('[API Comment] Lá»—i 500:', error);
    return res.status(500).json({ 
        success: false, 
        message: 'Lá»—i mÃ¡y chá»§ ná»™i bá»™. Vui lÃ²ng thá»­ láº¡i sau.' 
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
        res.status(500).json({ error: 'Lá»—i táº£i thÃ´ng bÃ¡o' });
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
        res.status(500).json({ error: 'Lá»—i cáº­p nháº­t' });
    }
});

app.post('/api/tasks', authenticateUser, async (req, res) => {
    try {
      const { title, desc, pic, deadline, status, urgent, facility, department_code } = req.body;
      
      let insert_dept_code = normalizeDept(department_code || facility);
      let insert_facility_id = null;

      // 1. CHỐNG PAYLOAD SPOOFING: ÉP CỨNG ĐỊNH DANH THEO ROLE
      if (!ALL_ACCESS_ROLES.includes(req.user.role)) {
          // Nhóm Local (VD: FACILITY_MANAGER)
          insert_dept_code = req.user.department_code;
          insert_facility_id = req.user.facility_id;
      } else {
          // Nhóm All-Access
          if (facility && facility !== 'HQ' && facility !== 'ALL') {
              let parsedFac = parseInt(facility, 10);
              if (!isNaN(parsedFac)) insert_facility_id = parsedFac;
              else {
                  const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [facility]);
                  if (facRecord.rows.length > 0) insert_facility_id = facRecord.rows[0].id;
              }
          }
      }

      let priorityStars = 0;
      if (req.user.role === 'SUPER_ADMIN') priorityStars = 3;
      else if (req.user.role === 'VICE_PRESIDENT') priorityStars = 2;

      // 2. KIá»‚M TRA CHÃ‰O PIC (NgÆ°á»i phá»¥ trÃ¡ch)
      let pic_id = null;
      if (pic) {
          let picQuery = 'SELECT id, facility_id, department_code FROM users WHERE (full_name = $1 OR email = $1)';
          let picParams = [pic];
          
          if (req.user.role === 'FACILITY_MANAGER') {
              picQuery += ' AND facility_id = $2';
              picParams.push(req.user.facility_id);
          } else if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
              // Department Head can only assign to people in their own department
              picQuery += ' AND (department_code = $2 OR department_id = $2)';
              picParams.push(insert_dept_code);
          }
          
          picQuery += ' LIMIT 1';
          const picUser = await pool.query(picQuery, picParams);
          
          if (picUser.rows.length === 0) {
              if (req.user.role === 'FACILITY_MANAGER' || req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
                  return res.status(403).json({message: "Lá»—i 403: KhÃ´ng Ä‘Æ°á»£c gÃ¡n chÃ©o nhÃ¢n sá»± ngoÃ i tháº©m quyá»n!"});
              } else {
                   const checkExist = await pool.query('SELECT id FROM users WHERE full_name = $1 OR email = $1 LIMIT 1', [pic]);
                   if (checkExist.rows.length > 0) pic_id = checkExist.rows[0].id;
              }
          } else {
              pic_id = picUser.rows[0].id;
          }
      }

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
      pic: pic || 'ChÆ°a gÃ¡n',
      picId: pic || 'unassigned',
      facility: facility || 'HQ',
      facilityId: facility || 'HQ'
    };


      res.json({ success: true, data: newTask });
  } catch (error) {
    console.error("Lá»—i chi tiáº¿t tá»« DB:", error.message, error.stack);
    res.status(500).json({ error: 'Lá»—i server khi lÆ°u cÃ´ng viá»‡c.' });
  }
});

// API ÄÄƒng nháº­p giáº£ láº­p
app.delete('/api/system/reset', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
       return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá»n' });
    }
    
    // Khá»Ÿi táº¡o Transaction báº£o vá»‡ tÃ­nh toÃ n váº¹n dá»¯ liá»‡u
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE company_knowledge_base RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE ai_chat_sessions RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE ai_chat_messages RESTART IDENTITY CASCADE');
      await client.query('DELETE FROM daily_logs WHERE entry_type != $1', ['SYSTEM_CONFIG']);
      await client.query('DELETE FROM daily_financial_reports');
      await client.query('COMMIT');
      res.json({ success: true, message: 'ÄÃ£ dá»n dáº¹p toÃ n bá»™ dá»¯ liá»‡u kiá»ƒm thá»­' });
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError; // NÃ©m lá»—i ra ngoÃ i catch tá»•ng
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Lá»—i reset system:", error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ khi reset system' });
  }
});


app.post('/api/login', async (req, res) => {
      let { username, password } = req.body;
      
      if (username) {
        username = username.trim().toLowerCase();
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
              return res.status(403).json({ success: false, error: 'TÃ i khoáº£n Ä‘Ã£ bá»‹ khÃ³a.' });
            }
            
            const isMatch = await bcrypt.compare(password, user.password_hash || '');
            const passToCheck = user.password || user.password_hash;
            
            if (isMatch || passToCheck === password || passToCheck === Buffer.from(password).toString('base64') || Buffer.from(passToCheck || '').toString('base64') === password) {
                const tokenPayload = {
                    id: user.id,
                    role: user.role_name,
                    facility_id: user.managed_facilities || user.facility_name || 'ALL',
                    facility_code: user.facility_code || 'ALL',
                    department_id: user.department_id || null,
                    department_code: user.department_code || null
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
                console.error("Sai máº­t kháº©u cho user:", username);
            }
        }
    } catch (e) {
        console.error("Lá»—i Ä‘Äƒng nháº­p DB:", e);
    }

    console.error("Lá»—i 401: KhÃ´ng tÃ¬m tháº¥y tÃ i khoáº£n hoáº·c máº­t kháº©u khÃ´ng khá»›p. Payload:", req.body);
    return res.status(401).json({ success: false, error: 'TÃ i khoáº£n hoáº·c máº­t kháº©u khÃ´ng chÃ­nh xÃ¡c.' });
});

// ==============================================================================
// 1.5. API DAILY CHECK-IN (BÃO CÃO Äáº¦U GIá»œ)
// ==============================================================================

// POST /api/checkin was removed because it is now handled by POST /api/logs

app.get('/api/checkin/status', authenticateUser, async (req, res) => {
  try {
    const todayStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(new Date());
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
      const calo = checkins.find(c => c.content && c.content.shift && c.content.shift.includes('Ca Lá»¡'));
      const ca2 = checkins.find(c => c.content && c.content.shift && c.content.shift.includes('Ca 2'));
      return {
        facility_id: fac,
        ca1: ca1 ? `ÄÃ£ bÃ¡o cÃ¡o lÃºc ${ca1.display_time}` : 'ChÆ°a bÃ¡o cÃ¡o',
        calo: calo ? `ÄÃ£ bÃ¡o cÃ¡o lÃºc ${calo.display_time}` : 'ChÆ°a bÃ¡o cÃ¡o',
        ca2: ca2 ? `ÄÃ£ bÃ¡o cÃ¡o lÃºc ${ca2.display_time}` : 'ChÆ°a bÃ¡o cÃ¡o',
        details: checkins
      };
    });

    res.json({ success: true, data: statusList });
  } catch (error) {
    res.status(500).json({ error: `Lá»—i server: ${error.message}` });
  }
});

// ==============================================================================
// 2. AUTO-TASKING AI (TÃCH Há»¢P OPENROUTER)
// ==============================================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-v1-xxxxxxxxxxxx'; 




const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 }, // Giá»›i háº¡n 500KB cho file text
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
            cb(null, true);
        } else {
            cb(new Error('Há»† THá»NG Tá»ª CHá»I: Chá»‰ cho phÃ©p táº£i lÃªn Ä‘á»‹nh dáº¡ng vÄƒn báº£n thuáº§n (.txt)'));
        }
    }
});

// API Náº P TRI THá»¨C VÃ€O RAG
app.post('/api/rag/upload', authenticateUser, checkAdmin, (req, res, next) => {
    // Bá»c middleware upload Ä‘á»ƒ há»©ng lá»—i file extension
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Vui lÃ²ng Ä‘Ã­nh kÃ¨m má»™t file .txt há»£p lá»‡." });
        }

        // Äá»c ná»™i dung file tá»« Buffer
        const textContent = req.file.buffer.toString('utf-8');
        if (!textContent.trim()) {
            return res.status(400).json({ error: "File rá»—ng, khÃ´ng cÃ³ dá»¯ liá»‡u Ä‘á»ƒ náº¡p." });
        }

        // ==========================================
        // THUáº¬T TOÃN CHUNKING (NGá»® NGHÄ¨A)
        // ==========================================
        const chunks = [];
        // TÃ¡ch vÄƒn báº£n thÃ nh cÃ¡c cÃ¢u dá»±a trÃªn dáº¥u káº¿t thÃºc cÃ¢u hoáº·c dáº¥u xuá»‘ng dÃ²ng
        const sentences = textContent.split(/(?<=[.!?\n])\s+/);
        
        let currentChunk = "";
        for (const sentence of sentences) {
            // Giá»›i háº¡n max ~1000 kÃ½ tá»± má»—i chunk
            if (currentChunk.length + sentence.length > 1000) {
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? " " : "") + sentence;
            }
        }
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        // ==========================================
        // VÃ’NG Láº¶P EMBEDDING & BÆ M VÃ€O VECTOR DB
        // ==========================================
        // Náº¿u Sáº¿p (All-Access) khÃ´ng cÃ³ phÃ²ng ban, Ä‘Æ°a vá» GLOBAL Ä‘á»ƒ chia sáº» chung
        const departmentCode = req.user.department_code || 'GLOBAL'; 
        let successCount = 0;

        for (const chunk of chunks) {
            // Gá»i AI táº¡o Vector 1536 chiá»u
            const embedding = await generateEmbedding(chunk);
            if (embedding) {
                const formatEmbedding = `[${embedding.join(',')}]`;
                const metadata = { 
                    department_code: departmentCode,
                    filename: req.file.originalname,
                    chunk_size: chunk.length
                };
                
                // LÆ°u vÃ o CSDL PgVector
                await pool.query(`
                    INSERT INTO company_knowledge_base (content, embedding, source_type, metadata, created_at)
                    VALUES ($1, $2::vector, $3, $4, NOW())
                `, [chunk, formatEmbedding, 'DOCUMENT_UPLOAD', JSON.stringify(metadata)]);
                
                successCount++;
            }
        }

        return res.json({ 
            success: true, 
            message: `Náº¡p tri thá»©c thÃ nh cÃ´ng! ÄÃ£ bÄƒm thÃ nh ${successCount} máº£nh (chunks) vÃ  nhÃºng an toÃ n vÃ o Vector DB.`,
        });

    } catch (error) {
        console.error("Lá»—i há»‡ thá»‘ng khi náº¡p tÃ i liá»‡u RAG:", error);
        return res.status(500).json({ error: "Lá»—i mÃ¡y chá»§ khi nhÃºng tÃ i liá»‡u (Embedding Error)." });
    }
});

app.post('/api/ai/auto-tasking', authenticateUser, async (req, res) => {
  try {
    const { meetingTranscript, facilityId } = req.body;

    if (!meetingTranscript) {
      return res.status(400).json({ error: 'Vui lÃ²ng cung cáº¥p biÃªn báº£n cuá»™c há»p.' });
    }

    const systemPrompt = `Báº¡n lÃ  má»™t AI Ä‘iá»u phá»‘i CÃ´ng viá»‡c xuáº¥t sáº¯c. Nhiá»‡m vá»¥: Äá»c biÃªn báº£n cuá»™c há»p vÃ  tá»± Ä‘á»™ng trÃ­ch xuáº¥t cÃ¡c cÃ´ng viá»‡c cáº§n lÃ m thÃ nh Ä‘á»‹nh dáº¡ng JSON strict.
TrÃ­ch xuáº¥t máº£ng "tasks" vá»›i cáº¥u trÃºc: "task_title", "pic", "deadline" (YYYY-MM-DDTHH:mm, máº·c Ä‘á»‹nh 17:00 náº¿u khÃ´ng cÃ³ giá»), "target_facility" (TÃªn cÆ¡ sá»Ÿ, vÃ­ dá»¥: CÆ¡ sá»Ÿ 1), "priority_level" (QuÃ©t vÄƒn báº£n: Náº¿u cÃ³ 'kháº©n cáº¥p', 'gáº¥p', 'ngay', 'há»a tá»‘c' -> 'URGENT'. Náº¿u khÃ´ng -> 'PRIORITY').`;

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
        console.error("AI khÃ´ng tráº£ vá» JSON há»£p lá»‡");
      }
    }

    res.json({ success: true, message: 'TrÃ­ch xuáº¥t Auto-Tasking thÃ nh cÃ´ng.', data: extractedTasks });

  } catch (error) {
    res.status(500).json({ error: 'Lá»—i khi gá»i AI API.' });
  }
});

// ==============================================================================
// 2.5. AI REVENUE EXTRACTION (PROXY CHO FRONTEND Äá»‚ TRÃNH CORS)
// ==============================================================================

app.post('/api/internal/extract-revenue', express.json({limit: '50mb'}), async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ error: 'Thiáº¿u dá»¯ liá»‡u hÃ¬nh áº£nh (Base64).' });
    }

    const systemPrompt = `ÄÃ¢y lÃ  báº£ng doanh thu. Cá»™t 1 lÃ  Thá»©, Cá»™t 2 lÃ  NgÃ y. CÃ¡c cá»™t tiáº¿p theo lÃ  Doanh thu cá»§a DB41, ACE, PQ, PA, PAV, DB01. HÃ£y bá» qua cÃ¡c hÃ ng tiÃªu Ä‘á». Äá»c tá»« hÃ ng cÃ³ chá»©a ngÃ y thÃ¡ng. Tráº£ vá» máº£ng JSON: [{"date": "DD/MM/YYYY", "revenues": {"DUBAI 41": 100000, "DUBAI ACE": 200000, "DUBAI PHÃš QUá»C": 300000, "DUBAI PA": 400000, "DUBAI PAV": 500000, "DUBAI PAK": 600000}}]`;

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
      return res.status(response.status).json({ error: 'Lá»—i tá»« OpenRouter API.' });
    }

    const aiData = await response.json();
    let parsedData = [];
    
    if (aiData.choices && aiData.choices.length > 0) {
      const aiText = aiData.choices[0].message.content;
      const jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
         return res.status(500).json({ error: 'AI khÃ´ng tráº£ vá» JSON há»£p lá»‡.' });
      }
    }

    res.json({ success: true, data: parsedData });

  } catch (error) {
    console.error('Lá»—i khi gá»i AI Extract API:', error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ ná»™i bá»™ khi gá»i AI API.' });
  }
});

app.post('/api/internal/extract-revenue-text', authenticateUser, async (req, res) => {
  try {
    const { prompt, content } = req.body;
    
    if (!prompt || !content) {
      return res.status(400).json({ error: 'Thiáº¿u dá»¯ liá»‡u prompt hoáº·c ná»™i dung.' });
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
      return res.status(response.status).json({ error: 'Lá»—i tá»« OpenRouter API.' });
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
         return res.status(500).json({ error: 'AI khÃ´ng tráº£ vá»  JSON há»£p lá»‡.' });
      }
    }

    // Tráº£ vá»  usage token Ä‘á»ƒ frontend log
    res.json({ success: true, data: parsedData, usage: aiData.usage });

  } catch (error) {
    console.error('Lá»—i khi gá» i AI Extract API (Text):', error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ ná»™i bá»™ khi gá» i AI API.' });
  }
});

// ==============================================================================
// 3. AI PING THáº¤U Cáº¢M (EMPATHETIC PING) & TONE ESCALATION
// ==============================================================================

// HÃ m tÃ­nh toÃ¡n má»©c Ä‘á»™ trá»… háº¡n (Tone Escalation)
const calculateTone = (deadlineDateStr) => {
  const deadline = new Date(deadlineDateStr);
  const today = new Date('2026-05-14T00:00:00Z'); // Láº¥y má»‘c thá»i gian hiá»‡n táº¡i theo context
  
  // TÃ­nh Ä‘á»™ chÃªnh lá»‡ch sá»‘ ngÃ y
  const diffTime = deadline - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

  if (diffDays > 1) {
    return {
      level: 'Há»— trá»£',
      guidance: 'Thá»ƒ hiá»‡n sá»± quan tÃ¢m tinh táº¿, há»i thÄƒm xem PIC cÃ³ gáº·p khÃ³ khÄƒn hay thiáº¿u nguá»“n lá»±c nÃ o khÃ´ng Ä‘á»ƒ ká»‹p deadline.'
    };
  } else if (diffDays === 0 || diffDays === 1) {
    return {
      level: 'Pre-deadline',
      guidance: 'TÃ´ng giá»ng KhÃ­ch lá»‡ & Chuáº©n bá»‹. Há»i thÄƒm xem báº¡n Ä‘Ã£ sáºµn sÃ ng nghiá»‡m thu chÆ°a. VÃ­ dá»¥: "NgÃ y mai lÃ  háº¡n chá»‘t, báº¡n Ä‘Ã£ sáºµn sÃ ng nghiá»‡m thu chÆ°a?"'
    };
  } else if (diffDays < 0 && diffDays >= -3) {
    return {
      level: 'Nháº¯c nhá»Ÿ chuyÃªn nghiá»‡p',
      guidance: 'Nháº¯c nhá»Ÿ lá»‹ch sá»± nhÆ°ng kiÃªn quyáº¿t. YÃªu cáº§u cáº­p nháº­t tÃ¬nh hÃ¬nh hiá»‡n táº¡i vÃ  Ä‘Æ°a ra cam káº¿t hoÃ n thÃ nh.'
    };
  } else {
    return {
      level: 'Cáº£nh bÃ¡o ká»· luáº­t',
      guidance: 'Giá»ng Ä‘iá»‡u nghiÃªm tÃºc, quyáº¿t liá»‡t. Nháº¥n máº¡nh viá»‡c Ä‘Ã£ trá»… háº¡n quÃ¡ lÃ¢u, yÃªu cáº§u bÃ¡o cÃ¡o nguyÃªn nhÃ¢n gá»‘c rá»… vÃ  giáº£i trÃ¬nh lÃªn cáº¥p quáº£n lÃ½ ngay láº­p tá»©c.'
    };
  }
};


// API: AI Tá»± Há» C Tá»« Chat (Admin One-Click)
app.post('/api/rag/learn-from-chat', authenticateUser, async (req, res) => {
    try {
        const { role, department_code } = req.user;
        
        // Báº£o máº­t (RBAC): Chá»‰ cÃ¡c cáº¥p cao Ä‘Æ°á»­c phÃ©p "dáº¡y" AI
        if (role !== 'SUPER_ADMIN' && role !== 'VICE_PRESIDENT' && role !== 'ADMIN') {
            return res.status(403).json({ error: "Chá»‰ Admin/Sáº¿p má»›i cÃ³ quyá» n náº¡p dá»¯ liá»‡u Chat vÃ o RAG." });
        }

        const { content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ error: "Ná»™i dung Ä‘oáº¡n chat khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng." });
        }

        const textContent = content.trim();

        // Thuáº­t toÃ¡n Chunking (Ngá»¯ nghÄ©a)
        const chunks = [];
        const sentences = textContent.split(/(?<=[.!?\n])\s+/);
        
        let currentChunk = "";
        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length > 1000) {
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? " " : "") + sentence;
            }
        }
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        const departmentCode = department_code || 'GLOBAL'; 
        let successCount = 0;

        for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk);
            
            const formatEmbedding = `[${embedding.join(',')}]`;
            
            const insertSql = `
                INSERT INTO company_knowledge_base (content, embedding, source_type, metadata)
                VALUES ($1, $2::vector, $3, $4)
            `;
            await pool.query(insertSql, [
                chunk, 
                formatEmbedding, 
                'CHAT_LEARNING', 
                JSON.stringify({ 
                    department_code: departmentCode, 
                    source: 'Admin_One_Click' 
                })
            ]);
            successCount++;
        }

        res.json({ 
            success: true, 
            chunks_processed: successCount, 
            message: `ÄÃ£ náº¡p thÃ nh cÃ´ng ${successCount} khá»‘i kiáº¿n thá»©c vÃ o nÃ£o AI.` 
        });

    } catch (error) {
        console.error("Lá»—i learn-from-chat:", error);
        res.status(500).json({ error: "Lá»—i mÃ¡y chá»§ khi nhÃºng dá»¯ liá»‡u chat." });
    }
});



// API: LÆ°u vÃ  láº¥y danh sÃ¡ch vi pháº¡m AI
app.get('/api/ai/violations', authenticateUser, checkAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM system_config WHERE key = $1', ['ai_violations']);
    let violations = [];
    if (rows.length > 0 && rows[0].data) {
       violations = rows[0].data;
    }
    res.json({ success: true, data: violations });
  } catch (error) {
    console.error('Lá»—i láº¥y AI violations:', error);
    res.status(500).json({ error: 'Lá»—i server' });
  }
});

app.post('/api/ai/violations', authenticateUser, checkAdmin, async (req, res) => {
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
    console.error('Lá»—i lÆ°u AI violations:', error);
    res.status(500).json({ error: 'Lá»—i server' });
  }
});

// API: KÃ­ch hoáº¡t AI Ping Ä‘Ã´n Ä‘á»‘c cÃ´ng viá»‡c
app.post('/api/ai/ping', authenticateUser, async (req, res) => {
  try {
    const { taskId } = req.body;
    const { rows: taskRows } = await pool.query(`
      SELECT t.id, t.title, TO_CHAR(t.deadline, 'YYYY-MM-DD') as deadline, u.full_name as pic_name
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      WHERE t.id = $1
    `, [taskId]);
    
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    }
    const task = taskRows[0];

    // 1. TÃ­nh toÃ¡n Tone nháº¯c viá»‡c dá»±a trÃªn Deadline
    const toneEscalation = calculateTone(task.deadline);

    // 2. Gá» i OpenRouter Ä‘á»ƒ sinh ná»™i dung nháº¯c viá»‡c tháº¥u cáº£m theo Tone Ä‘Ã£ tÃ­nh
    const systemPrompt = `
      Báº¡n lÃ  má»™t Trá»£ lÃ½ AI Cá»‘ váº¥n (AI Executive Advisor) trong há»‡ thá»‘ng TaskFlow AI. 
      Báº¡n Ä‘ang thá»±c hiá»‡n tÃ­nh nÄƒng "ÄÃ´n Ä‘á»‘c Tháº¥u cáº£m" (Empathetic Ping) nháº±m táº¡o Ã¡p lá»±c tiáº¿n Ä‘á»™ má»™t cÃ¡ch tinh táº¿.
      
      ThÃ´ng tin cÃ´ng viá»‡c:
      - TÃªn cÃ´ng viá»‡c: "${task.title}"
      - NgÆ°á»i phá»¥ trÃ¡ch (PIC): ${task.pic_name}
      - Háº¡n chÃ³t: ${task.deadline}
      - Má»©c Ä‘á»™ cáº£nh bÃ¡o (Tone Escalation): ${toneEscalation.level}
      - Äá»‹nh hÆ°á»›ng giá»ng Ä‘iá»‡u: ${toneEscalation.guidance}

      Nhiá»‡m vá»¥: Viáº¿t má»™t tin nháº¯n ngáº¯n gá»n (dÆ°á»›i 50 chá»¯), xÆ°ng hÃ´ lá»‹ch sá»± vá»›i ${task.pic_name}.
      ÄÃºng chuáº©n má»©c Ä‘á»™ cáº£nh bÃ¡o Ä‘Æ°á»£c yÃªu cáº§u. KhÃ´ng thÃªm lá»i chÃ o thá»«a thÃ£i nhÆ° "ChÃ o báº¡n", Ä‘i tháº³ng vÃ o váº¥n Ä‘á» theo cÃ¡ch tháº¥u cáº£m.
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
    let pingMessage = "ÄÃ£ xáº£y ra lá»—i sinh ná»™i dung nháº¯c viá»‡c.";
    
    if (aiData.choices && aiData.choices.length > 0) {
      pingMessage = aiData.choices[0].message.content.trim();
    }

    // 3. Ghi vÃ o "Báº£ng Log Nháº¯c viá»‡c AI" cÃ´ng khai
    await pool.query('INSERT INTO ai_ping_logs (task_id, message) VALUES ($1, $2)', [task.id, pingMessage]);
    const logEntry = {
      task_id: task.id,
      message: pingMessage,
      created_at: new Date().toISOString()
    };

    res.json({
      success: true,
      message: 'ÄÃ£ gá»­i AI Ping thÃ nh cÃ´ng.',
      data: {
        tone_escalation: toneEscalation.level,
        generated_message: pingMessage,
        log: logEntry
      }
    });

  } catch (error) {
    console.error('Lá»—i khi gá»i AI Ping:', error);
    res.status(500).json({ error: 'Lá»—i khi gá»i AI API.' });
  }
});


// ==============================================================================
// 3.5 BATCH AI PING
// ==============================================================================
app.post('/api/ai/ping-batch', authenticateUser, async (req, res) => {
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'Thiếu danh sách công việc.' });
    }

    const { rows: taskRows } = await pool.query(`
      SELECT t.id, t.title, TO_CHAR(t.deadline, 'YYYY-MM-DD') as deadline, u.full_name as pic_name
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      WHERE t.id = ANY($1)
    `, [taskIds]);
    
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy công việc nào.' });
    }

    const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
    const aiConfig = configRows.length > 0 ? configRows[0].data : {};
    const aiModel = aiConfig.model || "google/gemini-2.5-flash";

    const pingPromises = taskRows.map(async (task) => {
      try {
        const toneEscalation = calculateTone(task.deadline);
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
        let pingMessage = "Hệ thống: Công việc đang tới hạn.";
        if (aiData.choices && aiData.choices.length > 0) {
          pingMessage = aiData.choices[0].message.content.trim();
        }

        await pool.query('INSERT INTO ai_ping_logs (task_id, message) VALUES ($1, $2)', [task.id, pingMessage]);

        return {
          taskId: task.id,
          generated_message: pingMessage
        };
      } catch (innerErr) {
        console.error('Lỗi ping task ' + task.id, innerErr);
        return {
          taskId: task.id,
          generated_message: `Hệ thống: Công việc "${task.title}" đang tới hạn.`
        };
      }
    });

    const results = await Promise.all(pingPromises);

    res.json({
      success: true,
      message: 'Đã gửi AI Batch Ping thành công.',
      data: results
    });

  } catch (error) {
    console.error('Lỗi khi gọi AI Ping Batch:', error);
    res.status(500).json({ error: 'Lỗi khi gọi AI API.' });
  }
});

// ==============================================================================
// 4. BÃO CÃO THá»NG KÃŠ TOKEN (DB Váº¬T LÃ)
// ==============================================================================

app.post('/api/internal/log-tokens', authenticateUser, async (req, res) => {
  try {
    const { username, prompt_tokens, completion_tokens, total_tokens } = req.body;
    const query = `
      INSERT INTO ai_token_usage_logs (user_id, username, prompt_tokens, completion_tokens, total_tokens)
      VALUES ($1, $2, $3, $4, $5)
    `;
    // Use req.user.id provided by the auth middleware instead of null
    await pool.query(query, [req.user.id || null, username, prompt_tokens, completion_tokens, total_tokens]);
    res.json({ success: true });
  } catch (error) {
    console.error('Lá»—i lÆ°u log token:', error);
    res.status(500).json({ error: 'Lá»—i server khi lÆ°u token.' });
  }
});

app.get('/api/internal/ai-token-stats', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Quyá»n truy cáº­p bá»‹ tá»« chá»‘i. Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p dá»¯ liá»‡u há»‡ thá»‘ng.' });
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
    console.error('Lá»—i truy xuáº¥t thá»‘ng kÃª token:', error);
    res.status(500).json({ error: 'Lá»—i káº¿t ná»‘i cÆ¡ sá»Ÿ dá»¯ liá»‡u váº­t lÃ½.' });
  }
});

// ==============================================================================
// 5. DAILY FINANCIAL REPORTS (POSTGRESQL)
// ==============================================================================

app.get('/api/reports', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'FACILITY_MANAGER'].includes(role)) {
      return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá»n xem bÃ¡o cÃ¡o tÃ i chÃ­nh.' });
    }
    
    let query = 'SELECT * FROM daily_financial_reports WHERE 1=1';
    const params = [];
    
    if (role === 'FACILITY_MANAGER') {
        params.push(req.user.facility_id);
        query += ` AND facility_id = $${params.length}`;
    }
    
    query += ' ORDER BY date DESC';
    const { rows } = await pool.query(query, params);
    const mappedRows = rows.map(r => ({
      ...r,
      totalRevenue: Number(r.total_revenue),
      createdBy: r.created_by,
      timestamp: Number(r.timestamp)
    }));
    res.json({ success: true, data: mappedRows });
  } catch (error) {
    console.error('Lá»—i láº¥y bÃ¡o cÃ¡o doanh thu:', error);
    res.status(500).json({ error: 'Lá»—i server khi láº¥y doanh thu.' });
  }
});

app.post('/api/reports', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'FINANCE_DEPT' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá»n lÆ°u bÃ¡o cÃ¡o.' });
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
    console.error('Lá»—i lÆ°u bÃ¡o cÃ¡o doanh thu:', error);
    res.status(500).json({ error: 'Lá»—i server khi lÆ°u bÃ¡o cÃ¡o doanh thu.' });
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
    console.error('Lá»—i láº¥y KPI:', error);
    res.status(500).json({ error: 'Lá»—i server khi láº¥y KPI.' });
  }
});

app.post('/api/kpi', authenticateUser, async (req, res) => {
  try {
    const { role, name, username } = req.user;
    if (!['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'FINANCE_DEPT'].includes(role)) {
      return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá»n lÆ°u cáº¥u hÃ¬nh KPI.' });
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
    console.error('Lá»—i lÆ°u cáº¥u hÃ¬nh KPI:', error);
    res.status(500).json({ error: 'Lá»—i server khi lÆ°u cáº¥u hÃ¬nh KPI.' });
  }
});

// ==============================================================================
// SYSTEM CONFIG API
// ==============================================================================
app.get('/api/config', authenticateUser, checkAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM system_config');
    const configData = {};
    rows.forEach(row => { configData[row.key] = row.data; });
    res.json({ success: true, data: configData });
  } catch (error) {
    console.error('Lá»—i táº£i system config:', error);
    res.status(500).json({ error: 'Lá»—i server khi táº£i cáº¥u hÃ¬nh.' });
  }
});

app.post('/api/config', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user || {};
    if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
       return res.status(403).json({ error: 'KhÃ´ng cÃ³ quyá»n lÆ°u cáº¥u hÃ¬nh há»‡ thá»‘ng.' });
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
    console.error('Lá»—i lÆ°u system config:', error);
    res.status(500).json({ error: 'Lá»—i server khi lÆ°u cáº¥u hÃ¬nh há»‡ thá»‘ng.' });
  }
});



// ==============================================================================
// RAG ENGINE UTILS (Embedding & Knowledge Base)
// ==============================================================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function generateEmbedding(text) {
    if (!text || typeof text !== 'string') return null;
    try {
        const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://www.hubdb.app",
                "X-Title": "Hub Dubai AI"
            },
            body: JSON.stringify({
                model: "openai/text-embedding-3-small", 
                input: text 
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenRouter Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (data.data && data.data.length > 0) {
            return data.data[0].embedding; 
        }
        throw new Error(data.error?.message || 'Lỗi không xác định từ OpenRouter');
    } catch (error) {
        console.error('generateEmbedding Error:', error);
        return null;
    }
}

async function saveToKnowledgeBase(content, sourceType, metadata = {}) {
    try {
        const embedding = await generateEmbedding(content);
        if (!embedding) throw new Error("KhÃ´ng thá»ƒ táº¡o vector cho ná»™i dung.");
        
        const sql = `
            INSERT INTO company_knowledge_base (content, embedding, source_type, metadata)
            VALUES ($1, $2::vector, $3, $4)
            RETURNING id
        `;
        const formatEmbedding = `[${embedding.join(',')}]`; // Äá»‹nh dáº¡ng vector cho PgVector
        const { rows } = await pool.query(sql, [content, formatEmbedding, sourceType, JSON.stringify(metadata)]);
        return rows[0].id;
    } catch (error) {
        console.error('saveToKnowledgeBase Error:', error);
        throw error;
    }
}


// ==============================================================================
// TRUNG TÂM PHÂN QUYỀN AI (AI RBAC GUARDRAIL)
// ==============================================================================
function getAiPermissions(user) {
    if (!user || !user.role) {
        return { isGlobal: false, departmentCode: null, facilityId: null, facilityCode: null };
    }
    
    const role = user.role;
    const departmentCode = user.department_code || user.department_id || '';
    const facilityId = user.facility_id ? String(user.facility_id) : null;
    const facilityCode = user.facility_code ? String(user.facility_code) : null;
    
    // Quét toàn bộ mọi biến thể tiếng Việt và tiếng Anh của khối Marketing
    const isMarketing = Boolean(String(departmentCode).match(/MARKETING|TRUYỀN THÔNG|MKT|MEDIA/i));
    
    // Xác định quyền All-Access (Global)
    const isGlobal = role === 'SUPER_ADMIN' || 
                     role === 'VICE_PRESIDENT' || 
                     role === 'FINANCE_DEPT' ||
                     (role === 'DEPARTMENT_HEAD' && isMarketing);
                     
    return {
        isGlobal,
        departmentCode,
        facilityId,
        facilityCode
    };
}


// ==============================================================================
// TẦNG RAG SEARCH KẾT HỢP RBAC FILTERING (VERSION 2 - CHUẨN KIẾN TRÚC)
// ==============================================================================
async function searchKnowledgeBase(queryText, user, limit = 3) {
    try {
        const perms = getAiPermissions(user);
        
        // 1. Kiểm tra an toàn cho nhóm Local (Soft Reject)
        if (!perms.isGlobal && !perms.departmentCode && !perms.facilityId) {
            console.warn(`[SECURITY ALERT] User ${user.id} thiếu cả department_code và facility_id.`);
            return [{ content: "Hệ thống từ chối: Tài khoản của bạn chưa được cấu hình phòng ban hoặc cơ sở để tra cứu tài liệu." }];
        }

        const queryEmbedding = await generateEmbedding(queryText);
        if (!queryEmbedding) return [{ content: "Hệ thống: Không thể khởi tạo vector cho câu truy vấn." }];
        
        const formatEmbedding = `[${queryEmbedding.join(',')}]`;

        let sql = "";
        let params = [];

        // 2. Tách nhánh Truy vấn với biến perms chuẩn hóa
        if (perms.isGlobal) {
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE 1 - (embedding <=> $1::vector) > 0.3 -- Ngưỡng an toàn chống rác (Hallucination)
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;
            params = [formatEmbedding, limit];
        } else {
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE (
                       (metadata @> '{"department_code": "GLOBAL"}'::jsonb)
                       OR ($3::text IS NOT NULL AND metadata @> jsonb_build_object('department_code', $3::text))
                       OR ($4::text IS NOT NULL AND metadata @> jsonb_build_object('facility_id', $4::text))
                       OR ($5::text IS NOT NULL AND metadata @> jsonb_build_object('facility_code', $5::text))
                      )
                  AND 1 - (embedding <=> $1::vector) > 0.3 -- Ngưỡng an toàn chống rác
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;
            params = [formatEmbedding, limit, perms.departmentCode, perms.facilityId, perms.facilityCode];
        }
        
        const { rows } = await pool.query(sql, params);
        return rows;
    } catch (error) {
        console.error('searchKnowledgeBase Error:', error);
        return [{ content: "Hệ thống từ chối: Đã xảy ra lỗi nội bộ khi tra cứu cơ sở tri thức." }];
    }
}



// ==============================================================================
// AI ADVISOR CHAT API (WITH RAG MEMORY)
// ==============================================================================


// ==============================================================================
// BÆ¯á»šC 2.1: HÃ€M CHUáº¨N HÃ“A MÃƒ PHÃ’NG BAN (NÃ‚NG Cáº¤P XÃ“A Dáº¤U TIáº¾NG VIá»†T)
// ==============================================================================
function normalizeDeptCode(rawCode) {
    if (!rawCode) return null;
    
    // Loáº¡i bá» dáº¥u Tiáº¿ng Viá»‡t vÃ  Ä‘Æ°a vá» in hoa
    const normalized = rawCode.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    
    const map = {
        'TRUYEN THONG': 'MARKETING',
        'MKT': 'MARKETING',
        'KE TOAN': 'FINANCE',
        'TCKT': 'FINANCE',
        'KY THUAT': 'TECHNICAL',
        'IT': 'TECHNICAL',
        'NHAN SU': 'HR',
        'HCNS': 'HR',
        'BAN GIAM DOC': 'BGD'
    };
    
    // Náº¿u cÃ³ trong tá»« Ä‘iá»ƒn thÃ¬ láº¥y, khÃ´ng thÃ¬ giá»¯ nguyÃªn cÃ¡c kÃ½ tá»± chá»¯/sá»‘ vÃ  gáº¡ch dÆ°á»›i
    return map[normalized] || normalized.replace(/[^A-Z0-9]/g, '_');
}

// ==============================================================================
// BÆ¯á»šC 2.2 & 2.3: HÃ€M THá»°C THI CHÃNH (CHUáº¨N RBAC & DATA INTEGRITY)
// ==============================================================================
async function executeCreateTaskTool(args, user) {
    const { title, department_code, deadline, priority } = args;
    
    const normalizedDept = normalizeDeptCode(department_code);
    if (!normalizedDept) {
        return { error: "Lỗi: Mã phòng ban/cơ sở không hợp lệ hoặc bị trống." };
    }

    // 1. RBAC Guardrail: TÃ¡i sá»­ dá»¥ng logic chuáº©n tá»« RAG
    const perms = getAiPermissions(user);

    if (!perms.isGlobal) {
        const userDept = normalizeDeptCode(perms.departmentCode || (perms.facilityId ? String(perms.facilityId) : 'GLOBAL'));
        if (normalizedDept !== userDept) {
            return { error: `AI TỪ CHỐI: Bạn không có quyền tạo task cho phòng ban [${normalizedDept}]. Thẩm quyền của bạn giới hạn tại: [${userDept}].` };
        }
    }

    // 2. Validate Deadline chá»‘ng Crash DB
    let deadlineVal = null;
    if (deadline) {
        const parsedDate = new Date(deadline);
        if (isNaN(parsedDate.getTime())) {
            return { error: `Lỗi: AI truyền định dạng ngày tháng không hợp lệ (${deadline}). Yêu cầu định dạng YYYY-MM-DD.` };
        }
        deadlineVal = parsedDate;
    }

    // 3. Xá»­ lÃ½ logic Facility ID thÃ´ng minh (KhÃ´ng Hardcode)
    let finalFacilityId = user.facility_id;
    
    // Náº¿u All-Access user táº¡o task cho cÆ¡ sá»Ÿ khÃ¡c, tá»± Ä‘á»™ng tra cá»©u ID cá»§a cÆ¡ sá»Ÿ Ä‘Ã³
    if (perms.isGlobal && normalizedDept !== normalizeDeptCode(perms.departmentCode)) {
        const { rows } = await pool.query(`SELECT id FROM facilities WHERE code = $1 LIMIT 1`, [normalizedDept]);
        if (rows.length > 0) {
            finalFacilityId = rows[0].id;
        } else {
            // Fallback náº¿u khÃ´ng tÃ¬m tháº¥y, Ã©p dÃ¹ng facility_id cá»§a ngÆ°á»i táº¡o (hoáº·c nÃ©m lá»—i tÃ¹y logic PO)
            finalFacilityId = user.facility_id; 
        }
    }

    const priorityLevel = priority || 'MEDIUM';

    // 4. Thá»±c thi Database Insert
    const insertQuery = `
        INSERT INTO tasks (title, department_code, deadline, priority_level, created_by, facility_id) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id;
    `;
    
    try {
        const result = await pool.query(insertQuery, [
            title || null, normalizedDept || null, deadlineVal || null, priorityLevel || null, user.id || null, finalFacilityId || null
        ]);
        
        return {
            status: "success",
            message: `Tạo công việc thành công. ID: ${result.rows[0].id}`
        };
    } catch (error) {
        console.error("[CRITICAL TOOL ERROR] Lỗi khi thực thi Tool Tạo Công Việc:", error.message);
        return JSON.stringify({ 
            error: "Lỗi nội bộ khi lưu công việc. Hãy thông báo cho User biết hệ thống đang gặp sự cố." 
        });
    }
}


async function executeGetRevenueTool(args, user) {
    const { date_range, facility_code } = args;
    
    // 1. Áp dụng Hàm Trung Tâm Phân Quyền
    const perms = getAiPermissions(user);
    
    // 2. Cảnh báo và Chặn Quyền Xuyên Không (Cross-facility)
    if (!perms.isGlobal && (!facility_code || String(facility_code).toUpperCase().trim() !== String(perms.facilityCode).toUpperCase().trim())) {
        console.warn(`[SECURITY ALERT] User ${user.id} (Facility Code ${perms.facilityCode}) có hành vi truy cập bất hợp lệ với tham số: ${facility_code}`);
        return { error: `[SECURITY ALERT] Hệ thống từ chối: Tài khoản của bạn không đủ quyền tra cứu dữ liệu doanh thu của cơ sở chéo [${facility_code}].` };
    }

    const targetFacility = perms.isGlobal ? (facility_code ? String(facility_code) : null) : perms.facilityCode;

    // ==============================================================
    // FALLBACK DATE LOGIC: MIỄN NHIỄM VỚI MỌI SAI SÓT TỪ USER/AI
    // ==============================================================
    let startDate, endDate;

    if (date_range && typeof date_range === 'object' && date_range.startDate && date_range.endDate) {
        startDate = date_range.startDate;
        endDate = date_range.endDate;
    } else if (typeof date_range === 'string' && date_range.includes('-')) {
        const parts = date_range.split('-');
        startDate = parts[0]?.trim();
        endDate = parts[1]?.trim() || startDate; 
    } else {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        
        const formatToISO = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        startDate = formatToISO(firstDay);
        endDate = formatToISO(today);
        console.warn(`[REVENUE TOOL] Missing date_range. Fallback to current month: ${startDate} -> ${endDate}`);
    }

    let sql = "";
    let params = [];

    if (!targetFacility) {
        sql = `SELECT COALESCE(SUM((NULLIF(regexp_replace(item->>'revenue', '[^0-9]', '', 'g'), ''))::numeric), 0) + 
              COALESCE(SUM((NULLIF(regexp_replace(item->>'totalRevenue', '[^0-9]', '', 'g'), ''))::numeric), 0) AS aggregated_revenue
               FROM daily_financial_reports
               CROSS JOIN LATERAL jsonb_array_elements(
                   CASE 
                       WHEN jsonb_typeof(data) = 'array' THEN data 
                       WHEN jsonb_typeof(data->'facilities') = 'array' THEN data->'facilities' 
                       ELSE '[]'::jsonb 
                   END
               ) AS item
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= $1::date
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= $2::date`;
        params = [startDate || null, endDate || null];
    } else {
        sql = `SELECT COALESCE(SUM((NULLIF(regexp_replace(item->>'revenue', '[^0-9]', '', 'g'), ''))::numeric), 0) + 
              COALESCE(SUM((NULLIF(regexp_replace(item->>'totalRevenue', '[^0-9]', '', 'g'), ''))::numeric), 0) AS aggregated_revenue
               FROM daily_financial_reports
               CROSS JOIN LATERAL jsonb_array_elements(
                   CASE 
                       WHEN jsonb_typeof(data) = 'array' THEN data 
                       WHEN jsonb_typeof(data->'facilities') = 'array' THEN data->'facilities' 
                       ELSE '[]'::jsonb 
                   END
               ) AS item
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= $1::date
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= $2::date
                 AND EXISTS (
                     SELECT 1 FROM unnest(string_to_array($3::text, ',')) AS t(val)
                     WHERE TRIM(t.val) != '' AND (
                         REPLACE(REPLACE(UPPER(item->>'name'), 'DUBAI', 'DB'), ' ', '') = REPLACE(REPLACE(UPPER(TRIM(t.val)), 'DUBAI', 'DB'), ' ', '')
                         OR REPLACE(REPLACE(UPPER(item->>'facilityCode'), 'DUBAI', 'DB'), ' ', '') = REPLACE(REPLACE(UPPER(TRIM(t.val)), 'DUBAI', 'DB'), ' ', '')
                         OR REPLACE(REPLACE(UPPER(item->>'facilityName'), 'DUBAI', 'DB'), ' ', '') = REPLACE(REPLACE(UPPER(TRIM(t.val)), 'DUBAI', 'DB'), ' ', '')
                     )
                 )`;
        params = [startDate || null, endDate || null, targetFacility || null];
    }
    
    try {
        const { rows } = await pool.query(sql, params);
        return {
            status: "success",
            message: `Báo cáo doanh thu của hệ thống/cơ sở [${targetFacility || 'Toàn hệ thống'}] từ ngày ${startDate} đến ${endDate} là: ${Number(rows[0].aggregated_revenue).toLocaleString('vi-VN')} VNĐ.`
        };
    } catch (error) {
        console.error("[CRITICAL TOOL ERROR] Lỗi khi thực thi Tool Doanh Thu:", error.message);
        return JSON.stringify({ 
            error: "Lỗi nội bộ khi truy xuất CSDL. Hãy thông báo cho User biết hệ thống đang gặp sự cố và không thể lấy số liệu lúc này." 
        });
    }
}


async function detectAndLearnRule(message, role, userId) {
    if (role !== 'SUPER_ADMIN' && role !== 'VICE_PRESIDENT') {
        return null; // Chá»‰ Sáº¿p má»›i Ä‘Æ°á»£c táº¡o luáº­t
    }
    
    try {
        const systemPrompt = "Báº¡n lÃ  bá»™ lá»c chá»‰ Ä‘áº¡o. HÃ£y Ä‘á»c cÃ¢u cá»§a Sáº¿p. Náº¿u Ä‘Ã³ lÃ  má»™t chá»‰ Ä‘áº¡o, quy Ä‘á»‹nh, hoáº·c ná»™i quy má»›i vá» cÃ´ng viá»‡c, hÃ£y trÃ­ch xuáº¥t gá»n gÃ ng ná»™i dung cá»‘t lÃµi cá»§a chá»‰ Ä‘áº¡o Ä‘Ã³. Náº¿u Ä‘Ã³ chá»‰ lÃ  cÃ¢u chat bÃ¬nh thÆ°á»ng hoáº·c há»i Ä‘Ã¡p, tráº£ vá» chÃ­nh xÃ¡c chá»¯ 'NULL'.";
        
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini", // GPT-4o-mini for fast & cheap rule detection
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ]
            })
        });
        
        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            let result = data.choices[0].message.content.trim();
            // XÃ³a ngoáº·c kÃ©p náº¿u cÃ³
            if (result.startsWith('"') && result.endsWith('"')) {
                result = result.slice(1, -1);
            }
            if (result !== 'NULL' && result !== 'null') {
                await saveToKnowledgeBase(result, 'BOSS_INSTRUCTION', { userId, role });
                return result;
            }
        }
    } catch (e) {
        console.error("detectAndLearnRule error:", e);
    }
    return null;
}


/**
 * Láº¥y lá»‹ch sá»­ chat ngáº¯n háº¡n, cÃ³ bá» c Auth Check chá»‘ng ID Harvesting
 */

// ==========================================
// AI CHAT MODEL REPOSITORY (RBAC SECURE)
// ==========================================
/**
 * Lưu một tin nhắn mới vào cơ sở dữ liệu hội thoại
 */
async function saveChatMessage({ sessionId, role, content, toolCalls = null }) {
    const query = `
        INSERT INTO ai_chat_messages (session_id, role, content, tool_calls)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
    `;
    const values = [
        sessionId, 
        role, 
        content, 
        toolCalls ? JSON.stringify(toolCalls) : null
    ];
    
    const { rows } = await pool.query(query, values);
    return rows[0];
}

/**
 * Lấy lịch sử hội thoại chuẩn RBAC - Ngăn chặn đọc chéo Session
 */
async function getChatHistorySecure(sessionId, user) {
    // Thiết quân luật: Chỉ lấy tin nhắn nếu Session đó thuộc về User hoặc User có quyền All-Access
    const isGlobalUser = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'].includes(user.role) || 
                         (user.role === 'DEPARTMENT_HEAD' && user.department_code === 'MARKETING');

    let query = `
        SELECT m.id, m.role, m.content, m.tool_calls, m.created_at
        FROM ai_chat_messages m
        INNER JOIN ai_chat_sessions s ON m.session_id = s.id
        WHERE m.session_id = $1
    `;
    
    const values = [sessionId];

    if (!isGlobalUser) {
        // Nhóm Local: Khóa chết theo user_id tạo ra session đó
        query += ` AND s.user_id = $2`;
        values.push(user.id);
    }

    query += ` ORDER BY m.created_at ASC;`;

    const { rows } = await pool.query(query, values);
    return rows;
}

/**
 * Cập nhật context nén vào metadata của Session
 */
async function updateSessionMetadata(sessionId, metadataUpdate) {
    const query = `
        UPDATE ai_chat_sessions
        SET metadata = metadata || $2::jsonb
        WHERE id = $1
        RETURNING metadata;
    `;
    const { rows } = await pool.query(query, [sessionId, JSON.stringify(metadataUpdate)]);
    return rows[0]?.metadata;
}

async function getConversationContext(sessionId, userId) {
    if (!sessionId) return [];

    try {
        const authCheckSql = `
            SELECT id FROM ai_chat_sessions 
            WHERE id = $1 AND user_id = $2
        `;
        const { rows: sessionRows } = await pool.query(authCheckSql, [sessionId, userId]);
        
        if (sessionRows.length === 0) {
            console.warn(`[SECURITY ALERT] User ${userId} cố gắng truy cập trái phép Session ${sessionId}`);
            throw new Error("403 Forbidden: Bạn không có quyền truy cập vào phiên chat này!");
        }

        try {
            const historySql = `
                SELECT role, content 
                FROM ai_chat_messages 
                WHERE session_id = $1 
                ORDER BY created_at DESC 
                LIMIT 6
            `;
            const { rows: historyRows } = await pool.query(historySql, [sessionId]);
            
            return historyRows.reverse().map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        } catch (innerError) {
            console.warn("[WARNING] Missing ai_chat_messages table, returning empty context.");
            return [];
        }

    } catch (error) {
        console.error("Lỗi getConversationContext:", error);
        throw error;
    }
}

// ==========================================
// API LẤY LỊCH SỬ CHAT (Chỉ lấy Messages)
// ==========================================
app.get('/api/ai/sessions', authenticateUser, async (req, res) => {
    try {
        // Chỉ lấy ID và TITLE. Không JOIN. Không GROUP BY. 
        const { rows } = await pool.query(
            "SELECT id, title FROM ai_chat_sessions WHERE user_id = $1 ORDER BY timestamp DESC NULLS LAST, id DESC",
            [req.user.id]
        );
        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error("Lỗi lấy danh sách AI sessions:", error);
        res.status(500).json({ error: "Lỗi máy chủ khi lấy dữ liệu sessions." });
    }
});

app.post('/api/ai/sessions', authenticateUser, async (req, res) => {
    try {
        const newId = crypto.randomUUID();
        const user_id = req.user.id;
        
        const currentTime = Date.now();
        const { rows } = await pool.query(
            "INSERT INTO ai_chat_sessions (id, user_id, title, timestamp) VALUES ($1, $2, 'Cuộc trò chuyện mới', $3) RETURNING *",
            [newId, user_id, currentTime]
        );
        res.status(201).json({ success: true, data: rows[0] });
    } catch (error) {
        console.error("Lỗi tạo session AI:", error);
        res.status(500).json({ error: error.message }); // Ép trả về lỗi thực tế
    }
});

app.get('/api/ai/chat-sessions/:id/messages', authenticateUser, async (req, res) => {
    try {
        const sessionId = req.params.id;
        const checkSession = await pool.query(
            "SELECT id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2", 
            [sessionId, req.user.id]
        );
        
        if (checkSession.rowCount === 0) {
            return res.status(403).json({ error: "Lỗi phân quyền: Phiên làm việc không tồn tại hoặc không thuộc về bạn." });
        }

        const { rows: messages } = await pool.query(
            `SELECT id, role, content, created_at 
             FROM ai_chat_messages 
             WHERE session_id = $1 
             ORDER BY created_at ASC`,
            [sessionId]
        );

        res.json({
            success: true,
            data: messages
        });
    } catch (error) {
        console.error("Lỗi lấy lịch sử chat:", error);
        res.status(500).json({ error: "Lỗi máy chủ khi lấy dữ liệu chat." });
    }
});

app.post('/api/ai/chat', authenticateUser, async (req, res) => {
    try {
        const { message, session_id } = req.body;
        
        const userMessage = message || req.body.content;
        
        if (!userMessage) return res.status(400).json({ error: "Message is required" });

        // ==========================================
        // NHáº¬P 1: LÆ¯U CÃ‚U Há»ŽI & CHá»NG Máº¤T Dá»® LIá»†U
        // ==========================================
        if (session_id) {
            const checkSession = await pool.query("SELECT id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2", [session_id, req.user.id]);
            if (checkSession.rowCount === 0) return res.status(403).json({ error: "Lỗi phiên làm việc." });
            
            try {
                await saveChatMessage({ sessionId: session_id, role: 'user', content: userMessage });
            } catch (err) {
                console.warn("Failed to save user chat message", err.message);
            }
        }

        // ==========================================
        // NHáº¬P 2: RAG & Máº NG Lá»ŒC TIá»€M THá»¨C
        // ==========================================
        let learnedRule = await detectAndLearnRule(userMessage, req.user.role, req.user.id);
        let systemPromptAddition = "";
        
        if (learnedRule) {
            systemPromptAddition = String.fromCharCode(10) + `[Há»† THá»NG]: Báº¡n vá»«a tá»± Ä‘á»™ng náº¡p chá»‰ Ä‘áº¡o má»›i nÃ y vÃ o trÃ­ nhá»› RAG: "${learnedRule}". HÃ£y tráº£ lá»i ngÆ°á»i dÃ¹ng má»™t cÃ¡ch ngáº¯n gá»n, diá»‡n áº£nh vÃ  thÃ´ng bÃ¡o ráº±ng báº¡n Ä‘Ã£ ghi nhá»› luáº­t nÃ y vÃ o há»‡ thá»‘ng lÃµi.`;
        }

        const ragContextRows = await searchKnowledgeBase(userMessage, req.user, 3);
        const rawRagText = ragContextRows.map(row => row.content).join("\n\n");
        const ragContextText = rawRagText.length > 4000 ? rawRagText.substring(0, 4000) + "\n... [ÄÃ£ cáº¯t bá»›t do giá»›i háº¡n bá»™ nhá»›]" : rawRagText;
        
        const safeRole = req.user.role ? String(req.user.role).toUpperCase().trim() : '';
        const globalRoles = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'ADMIN', 'DEPARTMENT_HEAD'];
        const isLocalUser = !globalRoles.includes(safeRole);

        // Xây dựng Ngữ cảnh User (User Context)
        const userFacility = req.user.facility_code ? req.user.facility_code : 'Toàn cầu (Global)';
        const userPermissions = isLocalUser 
            ? 'Bạn chỉ có quyền xem dữ liệu nội bộ của cơ sở bạn đang quản lý.' 
            : 'Bạn có đặc quyền truy cập dữ liệu toàn hệ thống (Global).';

        let finalSystemPrompt = "Bạn là trợ lý ảo AI Advisor thông minh của hệ thống TaskFlow.\n" + 
            "THÔNG TIN BẮT BUỘC VỀ NGƯỜI DÙNG HIỆN TẠI:\n" +
            `- Chức vụ (Role): ${safeRole}\n` +
            `- Mã cơ sở (Facility Code): ${userFacility}\n` +
            `- Quyền hạn: ${userPermissions}\n\n` +
            (ragContextText ? "Dữ liệu tham khảo:\n" + ragContextText : "") + 
            systemPromptAddition;

        if (isLocalUser) {
            finalSystemPrompt += "\nLƯU Ý BẢO MẬT: Bạn chỉ được trả lời các câu hỏi liên quan sát sườn đến nghiệp vụ phòng ban của người dùng. Nếu người dùng hỏi ngoài phạm vi quyền hạn trên, bắt buộc trả về: [BLOCK_MISCONDUCT]";
        }



        let chatHistory = [];
        if (session_id) {
            try {
                const rows = await getChatHistorySecure(session_id, req.user);
                // Map cho AI format
                chatHistory = rows.map(r => {
                    const msg = { role: r.role, content: r.content };
                    
                    // [BẢN VÁ]: Phân tách rõ ràng format cho Assistant và Tool
                    if (r.role === 'assistant' && r.tool_calls) {
                        msg.tool_calls = r.tool_calls; // Trả lại mảng tool_calls
                    } else if (r.role === 'tool' && r.tool_calls) {
                        msg.tool_call_id = r.tool_calls.tool_call_id; // Đưa ra top-level
                        msg.name = r.tool_calls.name;                 // Đưa ra top-level
                    }
                    
                    return msg;
                });
            } catch (err) {
                console.warn("Lỗi getChatHistorySecure:", err.message);
            }
        }

        // ==========================================
        // BƯỚC 3.1: LẮP RÁP PAYLOAD CHUẨN MỰC
        // ==========================================
        const messagesPayload = [
            { role: "system", content: finalSystemPrompt },
            ...chatHistory,
            { role: "user", content: userMessage }
        ];

        // ==========================================
        // BƯỚC 3.2: MỞ CỔNG SSE GIỮ KẾT NỐI CLIENT (CHỐNG TIMEOUT)
        // ==========================================
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); 
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders(); 

        const tools = [
            {
                type: "function",
                function: {
                    name: "create_system_task",
                    description: "Tạo hoặc giao một công việc mới cho phòng ban/cơ sở trên hệ thống.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Tiêu đề công việc" },
                            department_code: { type: "string", description: "Tên phòng ban (VD: Truyền thông, Kế toán, DB41)" },
                            deadline: { type: "string", description: "Hạn chót (ISO format hoặc text)" },
                            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }
                        },
                        required: ["title", "department_code"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "get_revenue_report",
                    description: "Lấy báo cáo doanh thu của cơ sở/phòng ban theo thời gian.",
                    parameters: {
                        type: "object",
                        properties: {
                            date_range: { 
                                type: "string", 
                                description: "Khoảng thời gian cần xem doanh thu (ví dụ: hôm nay, tuần này, tháng này)",
                                enum: ["hôm nay", "tuần này", "tháng này"] 
                            },
                            facility_code: { 
                                type: "string", 
                                description: "Mã cơ sở cần xem (tùy chọn nhưng NẾU TRONG LỊCH SỬ CHAT CÓ ĐỀ CẬP THÌ BẮT BUỘC PHẢI LẤY MÃ ĐÓ). Để trống nếu xem toàn hệ thống." 
                            }
                        },
                        required: ["date_range"]
                    }
                }
            }
        ];

        const openRouterPayload = {
            model: process.env.AI_MODEL || 'google/gemini-2.5-pro', 
            messages: messagesPayload,
            tools: tools,
            stream: true
        };

        // ==========================================
        // BƯỚC 3.3: GỌI OPENROUTER API & BẮT LỖI TẦNG MẠNG
        // ==========================================
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                "HTTP-Referer": process.env.APP_URL || 'http://localhost:3000',
                "X-Title": "TaskFlow AI Dashboard",
                "Content-Type": "application/json" 
            },
            body: JSON.stringify(openRouterPayload)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("🚨 OpenRouter API Error:", response.status, errText);
            res.write(`data: ${JSON.stringify({ error: "Lỗi kết nối từ AI Core. Vui lòng kiểm tra lại cấu hình." })}\n\n`);
            return res.end();
        }

        let aiReplyContent = "";
        let promptTokens = 0; 
        let completionTokens = 0;
        let toolCallId = null;
        let toolCallName = null;
        let toolCallArguments = "";
        let toolCallsMap = {}; 
        let mainToolName = "";

        if (!response.body) {
                console.error("[CRITICAL] Lỗi OpenRouter Lần 1: Không có response.body. HTTP:", response.status);
                res.write(`data: ${JSON.stringify({ error: "Lỗi luồng kết nối AI. Vui lòng thử lại sau." })}\n\n`);
                return res.end();
            }
            let decoder = new TextDecoder("utf-8");
            let buffer = "";
            for await (const value of response.body) {
                
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                const lines = buffer.split(String.fromCharCode(10));
                buffer = lines.pop();
                
                for (const line of lines) {
                    if (line.startsWith("data: ") && line !== "data: [DONE]") {
                        try {
                            const parsed = JSON.parse(line.substring(6));
                            if (parsed.usage) {
                                promptTokens += parsed.usage.prompt_tokens || 0;
                                completionTokens += parsed.usage.completion_tokens || 0;
                            }
                            if (parsed.choices && parsed.choices.length > 0) {
                                const delta = parsed.choices[0].delta;
                                // 2. HỨNG DỮ LIỆU CHUẨN PARALLEL CALLING
                                if (delta && delta.tool_calls) {
                                    for (const tc of delta.tool_calls) {
                                        // Nếu chưa có index này trong Map, tạo mới
                                        if (!toolCallsMap[tc.index]) {
                                            toolCallsMap[tc.index] = { id: '', name: '', arguments: '' };
                                        }
                                        if (tc.id) toolCallsMap[tc.index].id = tc.id;
                                        if (tc.function && tc.function.name) {
                                            toolCallsMap[tc.index].name = tc.function.name;
                                            mainToolName = tc.function.name; // Lưu lại tên Tool chính
                                        }
                                        if (tc.function && tc.function.arguments) {
                                            toolCallsMap[tc.index].arguments += tc.function.arguments;
                                        }
                                    }
                                }
                                if (delta && delta.content) {
                                    aiReplyContent += delta.content;
                                    res.write(`data: ${JSON.stringify({ content: delta.content })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                }
                            }
                        } catch (e) {
                            console.error("Lá»—i parse JSON stream chunk:", e);
                        }
                    }
                }
            }

        // ==========================================
        // 3. XỬ LÝ VÀ GỘP NHIỀU TOOL CALLS THÀNH 1
        // ==========================================
        if (Object.keys(toolCallsMap).length > 0) {
            const parsedArgsList = [];
            const mappedToolCallsForHistory = [];
            
            // Parse an toàn từng Tool Call
            for (const index in toolCallsMap) {
                let rawArgs = toolCallsMap[index].arguments;
                try {
                    // Thuật toán Gắp lõi JSON xuyên Markdown (Cho Gemini)
                    const firstIdx = rawArgs.indexOf('{');
                    const lastIdx = rawArgs.lastIndexOf('}');
                    if (firstIdx !== -1 && lastIdx !== -1) {
                        rawArgs = rawArgs.substring(firstIdx, lastIdx + 1);
                    }
                    parsedArgsList.push(JSON.parse(rawArgs));
                    mappedToolCallsForHistory.push({
                        id: toolCallsMap[index].id || `call_generated_${index}`,
                        type: "function",
                        function: { name: toolCallsMap[index].name || mainToolName, arguments: rawArgs }
                    });
                } catch (err) {
                    console.warn(`[WARNING] Bỏ qua 1 Tool Chunk do lỗi Parse tại index ${index}:`, err.message);
                }
            }

            // Nếu không parse thành công được cục nào, báo lỗi UI
            if (parsedArgsList.length === 0) {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n❌ *Hệ thống: AI trả về định dạng tham số không hợp lệ. Vui lòng thử lại.*" }, finish_reason: "stop" }] })}\n\n`);
                res.write(`data: [DONE]\n\n`);
                return res.end();
            }

            // GỘP THAM SỐ (MERGE PARAMS)
            let finalArgs = parsedArgsList[0]; // Lấy cục đầu tiên làm gốc
            
            if (parsedArgsList.length > 1 && mainToolName === "get_revenue_report") {
                // Gộp tất cả facility_code từ các object khác nhau lại thành 1 chuỗi: "DB41, DBACE, DBPQ..."
                const mergedFacilities = parsedArgsList.map(a => a.facility_code).filter(Boolean).join(',');
                finalArgs.facility_code = mergedFacilities;
            }

            // 4. BẬT NHỊP TIM VÀ GỌI DB CHỈ MỘT LẦN DUY NHẤT
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n⏳ *Hệ thống: Đang tổng hợp báo cáo quy mô lớn, vui lòng đợi...*\n\n" } }] })}\n\n`);
            const keepAliveInterval = setInterval(() => res.write(': keep-alive ping\n\n'), 10000);

            try {
                let result;
                if (mainToolName === "create_system_task") {
                    result = await executeCreateTaskTool(finalArgs, req.user);
                } else if (mainToolName === "get_revenue_report") {
                    // Database chỉ chạy 1 lần với chuỗi "DB41, DBACE...", cực kỳ nhanh và không bị timeout!
                    result = await executeGetRevenueTool(finalArgs, req.user); 
                } else {
                    throw new Error(`Tool ${mainToolName} chưa được hỗ trợ.`);
                }

                // 5. CẮT CHUỖI CHỐNG TRÀN TOKEN (Truncation)
                let stringifiedResult = typeof result === 'string' ? result : JSON.stringify(result);
                if (stringifiedResult.length > 15000) {
                    stringifiedResult = stringifiedResult.substring(0, 15000) + "\n... [DỮ LIỆU ĐÃ BỊ CẮT BỚT. VUI LÒNG HỎI CỤ THỂ TỪNG CƠ SỞ].";
                }
                const toolResultStr = stringifiedResult;
                
            } catch (dbError) {
                console.error("[CRITICAL] Lỗi chạy Tool DB:", dbError);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n❌ *Hệ thống: Lỗi nội bộ khi truy xuất dữ liệu từ CSDL.*" }, finish_reason: "stop" }] })}\n\n`);
                res.write(`data: [DONE]\n\n`);
                return res.end();
            } finally {
                clearInterval(keepAliveInterval);
            }

                // Cập nhật messagesPayload cho lần gọi 2
                messagesPayload.push({
                    role: "assistant",
                    content: aiReplyContent || "",
                    tool_calls: mappedToolCallsForHistory
                });
                for (const tc of mappedToolCallsForHistory) {
                    messagesPayload.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        name: tc.function.name,
                        content: toolResultStr
                    });
                }
                
                openRouterPayload.messages = messagesPayload;

                const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, 
                        "HTTP-Referer": process.env.APP_URL || 'http://localhost:3000',
                        "X-Title": "TaskFlow AI Dashboard",
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify(openRouterPayload)
                });

                if (!response2.ok) {
                    const errText2 = await response2.text();
                    console.error("[CRITICAL] Lỗi OpenRouter Lần 2 (Tràn Token):", errText2);
                    if (typeof keepAliveInterval !== 'undefined') clearInterval(keepAliveInterval);
                    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n❌ *Hệ thống: Dữ liệu quá lớn, AI không thể phân tích hết trong một lần. Xin vui lòng tra cứu riêng từng cơ sở.* \n\n" } }] })}\n\n`);
                    res.write(`data: [DONE]\n\n`);
                    return res.end();
                }

                if (!response2.body) {
                        console.error("[CRITICAL] Lỗi OpenRouter Lần 2: Không có response2.body. HTTP:", response2.status);
                        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n❌ *Hệ thống: Lỗi kết nối luồng AI lần 2.* \n\n" } }] })}\n\n`);
                        res.write(`data: [DONE]\n\n`);
                        return res.end();
                    }
                    let decoder2 = new TextDecoder("utf-8");
                    let buffer2 = "";
                    for await (const value of response2.body) {
                        const chunk = decoder2.decode(value, { stream: true });
                        buffer2 += chunk;
                        const lines = buffer2.split(String.fromCharCode(10));
                        buffer2 = lines.pop();
                        for (const line of lines) {
                            if (line.startsWith("data: ") && line !== "data: [DONE]") {
                                try {
                                    const parsed = JSON.parse(line.substring(6));
                                    if (parsed.usage) {
                                        promptTokens += parsed.usage.prompt_tokens || 0;
                                        completionTokens += parsed.usage.completion_tokens || 0;
                                    }
                                    if (parsed.choices && parsed.choices.length > 0) {
                                        const contentChunk = parsed.choices[0].delta?.content || "";
                                        if (contentChunk) {
                                            aiReplyContent += contentChunk;
                                            res.write(`data: ${JSON.stringify({ content: contentChunk })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                    }
            } // closes if (Object.keys(toolCallsMap).length > 0)

        // Káº¿t thÃºc luá»“ng stream an toÃ n
        if (!res.writableEnded) {
            res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            res.end();
        }

        // ==========================================
        // NHẬP 4: LƯU DB & GHI LOG BẢO MẬT
        // ==========================================
        if (session_id && (aiReplyContent || Object.keys(toolCallsMap).length > 0)) {
            try {
                let toolCalls = null;
                if (Object.keys(toolCallsMap).length > 0) {
                     toolCalls = Object.values(toolCallsMap).map(tc => ({
                         id: tc.id,
                         type: "function",
                         function: { name: tc.name, arguments: tc.arguments }
                     }));
                }
                
                await saveChatMessage({ 
                     sessionId: session_id, 
                     role: 'assistant', 
                     content: aiReplyContent || "",
                     toolCalls: toolCalls
                });
                
                if (toolCalls && typeof toolResultStr !== 'undefined' && typeof mappedToolCallsForHistory !== 'undefined') {
                     for (const tc of mappedToolCallsForHistory) {
                         await saveChatMessage({
                             sessionId: session_id,
                             role: 'tool',
                             content: toolResultStr, // The JSON result
                             toolCalls: { tool_call_id: tc.id, name: tc.function.name } // Luu vet tool call id
                         });
                     }
                }
            } catch (innerErr) {
                console.error("Lỗi lưu tin nhắn AI vào DB:", innerErr.message);
            }
        }

        if (promptTokens > 0 || completionTokens > 0) {
            const totalTokens = promptTokens + completionTokens;
            try {
                await updateSessionMetadata(session_id, { tokens: { total: totalTokens } });
            } catch (metaErr) {
                console.error("Lỗi cập nhật metadata token:", metaErr.message);
            }
        }

    } catch (error) {
        console.error("Lỗi bao quát tại API AI Chat:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Lỗi máy chủ nội bộ." });
        } else {
            res.write(`data: ${JSON.stringify({ error: "Lỗi đứt gãy Stream nội bộ." })}\n\n`);
            res.end();
        }
    }
});

// --- BẮT ĐẦU KHỐI CODE AI CHAT STREAM ---

console.log("=== BINGO! ROUTE AI STREAM ĐĐƯỢC LOAD VÀO SERVER ===");
app.post('/api/ai/chat-stream', authenticateUser, async (req, res) => {
  // 1. THIẾT LẬP HEADER CHUẨN SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 2. ANTI-TIMEOUT: Gửi ngay một comment rỗng để ép Render mở luồng kết nối (Bypass 15s limit)
  res.write(':\n\n');

  // 3. XỬ LÝ SỰ KIỆN CLIENT NGẮT KẾT NỐI
  req.on('close', () => {
    console.log('[SSE] Client đã ngắt kết nối. Dừng stream.');
    res.end();
  });

  let userMsgId = null; // Khai báo ngoài try-catch để rollback trong catch

  try {
    let { message, session_id } = req.body;
    const user_id = req.user.id;
    
    // Nếu rỗng HOẶC là ID rác do Frontend tự chế (bắt đầu bằng 'session_')
    if (!session_id || session_id === 'null' || String(session_id).startsWith('session_')) {
        // TẠO SESSION CHUẨN XỊN (Dùng crypto.randomUUID để khớp với schema hiện tại)
        const newSessionId = crypto.randomUUID();
        const currentTime = Date.now();
        const sessionResult = await pool.query(
            "INSERT INTO ai_chat_sessions (id, user_id, title, timestamp) VALUES ($1, $2, 'Cuộc trò chuyện mới', $3) RETURNING id",
            [newSessionId, user_id, currentTime]
        );
        session_id = sessionResult.rows[0].id;
        console.log("🛠️ Đã tạo Session UUID chuẩn:", session_id);
    }
    
    console.log("=== ĐANG XỬ LÝ CHAT CHO SESSION ID:", session_id, "===");
    
    // Bắn session_id về cho Frontend đồng bộ State
    res.write(`data: ${JSON.stringify({ new_session_id: session_id })}\n\n`);
    
    if (!message) {
        throw new Error("Thiếu message");
    }

    // 1. LẤY LỊCH SỬ CHAT
    const { rows: historyRows } = await pool.query(
      `SELECT role, content FROM ai_chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [session_id]
    );
    const formattedHistory = historyRows.map(r => ({ role: r.role, content: r.content }));

    // 2. LƯU TIN NHẮN USER & GIỮ LẠI ID ĐỂ ROLLBACK
    const userMsgResult = await pool.query(
      `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'user', $2) RETURNING id`,
      [session_id, message]
    );
    userMsgId = userMsgResult.rows[0].id;

    // Cập nhật lại thời gian của Session để nó nhảy lên top
    const updateTime = Date.now();
    await pool.query(
        "UPDATE ai_chat_sessions SET timestamp = $1 WHERE id = $2",
        [updateTime, session_id]
    );

    // 3. ĐÁNH CHẶN RAG - CẤY NÃO SỐ LIỆU THỰC TẾ
    let systemContext = `Bạn là Master AI Cố vấn của hệ thống HubDB.
1. VỀ SỐ LIỆU: Dựa TUYỆT ĐỐI vào dữ liệu nội bộ được cung cấp dưới đây. Nếu không tìm thấy số liệu, hãy báo cáo thẳng thắn, lịch sự là hệ thống chưa ghi nhận, không tự bịa số liệu.
2. VỀ PHONG CÁCH: Hãy linh hoạt đọc vị yêu cầu của sếp:
   - Nếu sếp hỏi nhanh số liệu (vd: "dt db41", "có ai nghỉ không"): Trả lời số liệu trực diện, súc tích.
   - Nếu sếp yêu cầu lập kế hoạch, báo cáo tổng quan, so sánh: Hãy phân tích sâu sắc, chia luận điểm rõ ràng, đánh giá và đưa ra giải pháp chiến lược.
3. KHÔNG bị ảnh hưởng bởi văn phong của các phiên chat cũ. Tự quyết định độ dài và giọng điệu dựa trên câu hỏi HIỆN TẠI.\n\n`;
    let hasData = false;
    // Lấy câu nói gần nhất của AI từ lịch sử
    let previousAiMessage = "";
    if (formattedHistory.length > 0 && (formattedHistory[formattedHistory.length - 1].role === 'assistant' || formattedHistory[formattedHistory.length - 1].role === 'ai')) {
        previousAiMessage = formattedHistory[formattedHistory.length - 1].content;
    }
    
    // Gộp cả câu hỏi hiện tại và câu trả lời trước đó để dò từ khóa
    const contextMsg = (previousAiMessage + " " + message).toLowerCase();

    try {
        // Quét Công việc (Dùng contextMsg)
        if (contextMsg.includes('task') || contextMsg.includes('công việc') || contextMsg.includes('trễ') || contextMsg.includes('phụ trách') || contextMsg.includes('dự án') || contextMsg.includes('ai làm')) {
            
            // Lấy thẳng danh sách 20 task mới nhất thay vì đếm số
            const { rows } = await pool.query("SELECT * FROM tasks ORDER BY id DESC LIMIT 20");
            
            if (rows.length > 0) {
                const taskData = rows.map(r => `[Task: ${r.title || r.name || 'Không tên'} | Trạng thái: ${r.status} | Phụ trách: ${r.assignee || r.user_id || 'Chưa phân công'}]`).join('\n');
                systemContext += `- Danh sách công việc chi tiết hiện tại:\n${taskData}\n`;
            } else {
                systemContext += `- Công việc: Hệ thống không có dữ liệu task nào.\n`;
            }
            hasData = true;
        }
        
        // Quét từ khóa Nhân sự / User
        if (contextMsg.includes('nhân sự') || contextMsg.includes('người dùng') || contextMsg.includes('nhân viên')) {
            const { rows } = await pool.query("SELECT COUNT(*) as count FROM users");
            systemContext += `- Tổng số nhân sự hệ thống: ${rows[0].count} người.\n`;
            hasData = true;
        }

        // 1. Quét từ khóa Doanh thu / Tài chính (Regex Cấp Độ 2)
        // Bắt mọi từ lóng: doanh thu, dt, tiền, tổng kết... VÀ cả việc chỉ gọi tên cơ sở
        const isRevenueIntent = contextMsg.match(/(doanh thu|tài chính|tiền| dt |bán hàng|tổng kết|báo cáo)/i) || contextMsg.match(/(db[a-z0-9]+)/i);

        if (isRevenueIntent) {
            let queryStr = "SELECT date, total_revenue, data FROM daily_financial_reports WHERE 1=1";
            const queryParams = [];
            
            
            // Bắt Tháng (VD: tháng 5, t5, t05)
            const matchMonth = contextMsg.match(/tháng (\d+)|t(\d+)/i);
            let isMonthQuery = false;
            if (matchMonth) {
                isMonthQuery = true;
                const monthStr = (matchMonth[1] || matchMonth[2]).padStart(2, '0');
                queryParams.push(`%/${monthStr}/%`);
                queryParams.push(`%-${monthStr}-%`);
                queryStr += ` AND (date LIKE $${queryParams.length - 1} OR date LIKE $${queryParams.length})`;
            }

            // Gài LIMIT Động
            let recordLimit = 7; // Mặc định 1 tuần
            if (isMonthQuery || contextMsg.includes('tháng')) recordLimit = 31;
            if (contextMsg.includes('quý')) recordLimit = 90;
            if (contextMsg.includes('năm')) recordLimit = 365;

            queryStr += ` ORDER BY (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) DESC LIMIT ${recordLimit}`;
            
            const { rows } = await pool.query(queryStr, queryParams);
            if (rows.length > 0) {
                const revenueData = rows.map(r => `[Ngày ${r.date} - Tổng: ${Number(r.total_revenue).toLocaleString('vi-VN')} VNĐ | JSON: ${JSON.stringify(r.data)}]`).join('\n');
                systemContext += `- Dữ liệu tài chính nội bộ:\n${revenueData}\n`;
            } else {
                systemContext += `- Doanh thu: Không tìm thấy dữ liệu khớp yêu cầu.\n`;
            }
            hasData = true;
        }

        // Quét từ khóa Check-in / Điểm danh
        if (contextMsg.includes('check-in') || contextMsg.includes('checkin') || contextMsg.includes('điểm danh') || contextMsg.includes('chấm công')) {
            const todayStr = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Asia/Ho_Chi_Minh',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).format(new Date()); // DD/MM/YYYY
            const { rows } = await pool.query(
                "SELECT org_unit, COUNT(*) as count FROM daily_logs WHERE entry_type = 'Attendance' AND date = $1 GROUP BY org_unit",
                [todayStr]
            );
            if (rows.length > 0) {
                const checkinData = rows.map(r => `[${r.org_unit}: ${r.count} lượt]`).join(', ');
                systemContext += `- Dữ liệu điểm danh hôm nay (${todayStr}): ${checkinData}.\n`;
            } else {
                systemContext += `- Điểm danh hôm nay (${todayStr}): Chưa có dữ liệu điểm danh nào được báo cáo.\n`;
            }
            hasData = true;
        }
    } catch (dbErr) {
        console.error("CRITICAL RAG ERROR:", dbErr);
        systemContext += `- LƯU Ý KỸ THUẬT: Đã xảy ra lỗi khi trích xuất dữ liệu nội bộ (${dbErr.message}). Hãy báo cáo cho sếp biết hệ thống DB đang lỗi.\n`;
        hasData = true; // Bật cờ này lên để AI chắc chắn nhận được thông báo lỗi
    }

    // Build mảng tin nhắn gửi cho OpenRouter
    console.log("4. System Context cuối cùng gửi cho AI:", systemContext);
    console.log("5. Mảng Lịch sử Chat (History) đang chứa:", JSON.stringify(formattedHistory, null, 2));

    const messagesForAI = hasData 
        ? [{ role: "system", content: systemContext }, ...formattedHistory, { role: "user", content: message }]
        : [...formattedHistory, { role: "user", content: message }];

    // 4. GỌI API OPENROUTER (KÈM CONTEXT & STREAM)
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        stream: true,
        messages: messagesForAI
      })
    });

    if (!openRouterResponse.ok) {
      throw new Error(`Lỗi từ OpenRouter: ${openRouterResponse.status}`);
    }

    // 3. STREAM & GOM TEXT
    let fullAiResponse = "";
    
    for await (const chunk of openRouterResponse.body) {
      const textChunk = chunk.toString('utf-8');
      const lines = textChunk.split('\n').filter(line => line.trim() !== '');
      
      for (const line of lines) {
        if (line === 'data: [DONE]') continue;
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const chunkText = parsed.choices?.[0]?.delta?.content || "";
            
            if (chunkText) {
              fullAiResponse += chunkText;
              res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
            }
          } catch (e) {
            console.warn("Parse error:", e);
          }
        }
      }
    }

    // 4. LƯU TIN NHẮN AI & KẾT THÚC RESPONSE
    res.write('data: [DONE]\n\n');
    res.end();

    // NGAY SAU KHI STREAM XONG, BẮT BUỘC LƯU VÀO DATABASE:
    if (fullAiResponse.trim()) {
        console.log("Chuỗi AI chuẩn bị lưu:", fullAiResponse);
        try {
            await pool.query(
                "INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)",
                [session_id, fullAiResponse]
            );
            console.log("✅ Đã lưu tin nhắn AI vào DB thành công.");
        } catch (dbErr) {
            console.error("❌ Lỗi lưu DB:", dbErr);
        }
    }

  } catch (error) {
    console.error("Lỗi AI Chat Stream:", error);
    
    // XỬ LÝ NGOẠI LỆ (ROLLBACK): Đánh dấu lỗi nếu có ID tin nhắn User
    if (userMsgId) {
      try {
        await pool.query(
          `DELETE FROM ai_chat_messages WHERE id = $1`,
          [userMsgId]
        );
        console.log(`Đã rollback (xóa) tin nhắn User ID: ${userMsgId}`);
      } catch (dbError) {
        console.error("Lỗi khi update is_error:", dbError);
      }
    }

    res.write(`data: ${JSON.stringify({ error: error.message || "Lỗi máy chủ" })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// --- CHẶN 404 TOÀN CỤC ---
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint không tồn tại trên hệ thống.' });
});
// --- KẾT THÚC ---

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ðŸš€ TaskFlow AI Server Ä‘ang cháº¡y táº¡i http://localhost:${PORT}`);
  console.log(`[DB] DATABASE_URL: ${process.env.DATABASE_URL ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_HOST: ${process.env.DB_HOST ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_NAME: ${process.env.DB_NAME ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_USER: ${process.env.DB_USER ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_PORT: ${process.env.DB_PORT ? 'OK' : 'UNDEFINED'}`);
  console.log(`[API] SUPABASE_KEY: ${process.env.SUPABASE_KEY ? 'OK' : 'UNDEFINED'}`);
});



