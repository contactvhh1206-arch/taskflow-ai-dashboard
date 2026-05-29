import express from 'express';
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

const mockTasks = [
  { id: 1, title: 'Báº£o trÃ¬ mÃ¡y láº¡nh', facility_id: 1, pic_id: 2, pic_name: 'Tráº§n Thá»‹ B', status: 'todo', deadline: '2026-05-15' },
  { id: 2, title: 'Nghiá»‡m thu KPI', facility_id: 2, pic_id: 3, pic_name: 'LÃª VÄƒn C', status: 'review', deadline: '2026-05-12' }, // Trá»… 2 ngÃ y
  { id: 3, title: 'LÃªn chiáº¿n dá»‹ch Ads', facility_id: 'ALL', pic_id: 4, pic_name: 'Pháº¡m D', status: 'in_progress', deadline: '2026-05-10' } // Trá»… 4 ngÃ y
];

// Báº£ng Log Nháº¯c viá»‡c AI (CÃ´ng khai cho Sáº¿p Tá»•ng / Tá»•ng quáº£n lÃ½)
const mockAiPingLogs = [];

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
                console.error('[Auth Middleware] Lá»—i giáº£i mÃ£ Token:', jwtErr.message);
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
        return res.status(400).json({ error: 'Máº­t kháº©u hiá»‡n táº¡i khÃ´ng chÃ­nh xÃ¡c.' });
      }
      hardcodedPasswords[username] = newPassword;
      return res.json({ success: true, message: 'Äá»•i máº­t kháº©u thÃ nh cÃ´ng (tÃ i khoáº£n demo).' });
    }
    
    // Find user in DB
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1 OR full_name = $1`, [username]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y thÃ´ng tin tÃ i khoáº£n.' });
    }
    
    const user = rows[0];
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash || '');
    const passToCheck = user.password || user.password_hash;
    
    if (!(isMatch || passToCheck === currentPassword || passToCheck === Buffer.from(currentPassword).toString('base64') || Buffer.from(passToCheck || '').toString('base64') === currentPassword)) {
      return res.status(400).json({ error: 'Máº­t kháº©u hiá»‡n táº¡i khÃ´ng chÃ­nh xÃ¡c.' });
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

    if (
        role === 'SUPER_ADMIN' || 
        role === 'VICE_PRESIDENT' || 
        (role === 'DEPARTMENT_HEAD' && userDept === 'MARKETING')
    ) {
        // NhÃ³m All-Access: KhÃ´ng Ã¡p dá»¥ng Ä‘iá»u kiá»‡n lá»c bá»• sung
    } else {
        // NhÃ³m Local: Ãp dá»¥ng chung cho FACILITY_MANAGER, FINANCE_DEPT...
        params.push(userDept, id, id);
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

    // 1. Láº¤Y USER_ID AN TOÃ€N VÃ€ CHáº¶N NGAY Náº¾U Rá»–NG (NguyÃªn nhÃ¢n gá»‘c gÃ¢y sáº­p)
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
        console.error("Lá»—i parse user an toÃ n:", parseErr);
    }

    // [QUAN TRá»ŒNG NHáº¤T]: TRáº M GÃC CHá»NG Sáº¬P DB
    if (!realUserId) {
        return res.status(403).json({ error: 'KhÃ´ng thá»ƒ xÃ¡c Ä‘á»‹nh danh tÃ­nh. Vui lÃ²ng Ä‘Äƒng nháº­p láº¡i!' });
    }

    // 2. THá»°C THI INSERT (LÃºc nÃ y realUserId Ä‘Ã£ Ä‘Æ°á»£c Ä‘áº£m báº£o 100% lÃ  an toÃ n)
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

      // 1. CHá»NG PAYLOAD SPOOFING: Ã‰P Cá»¨NG Äá»ŠNH DANH THEO ROLE
      if (req.user.role === 'FACILITY_MANAGER') {
          insert_facility_id = req.user.facility_id;
      } else if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT' || req.user.role === 'LOCAL') {
          insert_dept_code = normalizeDept(req.user.department_code || req.user.department_id);
          
          if (facility && facility !== 'HQ' && facility !== 'ALL') {
              let parsedFac = parseInt(facility, 10);
              if (!isNaN(parsedFac)) insert_facility_id = parsedFac;
              else {
                  const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [facility]);
                  if (facRecord.rows.length > 0) insert_facility_id = facRecord.rows[0].id;
              }
          }
      } else {
          // ADMIN hoáº·c VICE_PRESIDENT
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
      
      if (username === 'admin' && password === hardcodedPasswords['admin']) {
      return res.json({
        success: true,
        token: 'mock-jwt-token-admin',
        user: { name: 'Sáº¿p Tá»•ng', role: 'SUPER_ADMIN', facility_id: 'ALL', username: 'admin' }
      });
    } else if (username === 'manager1' && password === hardcodedPasswords['manager1']) {
      return res.json({
        success: true,
        token: 'mock-jwt-token-manager',
        user: { name: 'Quáº£n lÃ½ CÆ¡ sá»Ÿ 1', role: 'FACILITY_MANAGER', facility_id: 'CÆ¡ sá»Ÿ 1', username: 'manager1' }
      });
    } else if (username === 'sysadmin' && password === hardcodedPasswords['sysadmin']) {
      return res.json({
        success: true,
        token: 'mock-jwt-token-sysadmin',
        user: { name: 'Quáº£n trá»‹ viÃªn Há»‡ thá»‘ng (IT)', role: 'ADMIN', facility_id: 'ALL', username: 'sysadmin' }
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
              return res.status(403).json({ success: false, error: 'TÃ i khoáº£n Ä‘Ã£ bá»‹ khÃ³a.' });
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
         return res.status(500).json({ error: 'AI khÃ´ng tráº£ vá» JSON há»£p lá»‡.' });
      }
    }

    // Tráº£ vá» usage token Ä‘á»ƒ frontend log
    res.json({ success: true, data: parsedData, usage: aiData.usage });

  } catch (error) {
    console.error('Lá»—i khi gá»i AI Extract API (Text):', error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ ná»™i bá»™ khi gá»i AI API.' });
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

  // API: Lá»‹ch sá»­ há»™i thoáº¡i AI toÃ n cáº§u (Global Memory)
  
// API: AI Tá»± Há»c Tá»« Chat (Admin One-Click)
app.post('/api/rag/learn-from-chat', authenticateUser, async (req, res) => {
    try {
        const { role, department_code } = req.user;
        
        // Báº£o máº­t (RBAC): Chá»‰ cÃ¡c cáº¥p cao Ä‘Æ°á»£c phÃ©p "dáº¡y" AI
        if (role !== 'SUPER_ADMIN' && role !== 'VICE_PRESIDENT' && role !== 'ADMIN') {
            return res.status(403).json({ error: "Chá»‰ Admin/Sáº¿p má»›i cÃ³ quyá»n náº¡p dá»¯ liá»‡u Chat vÃ o RAG." });
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
  app.get('/api/ai/sessions', authenticateUser, async (req, res) => {
    try {
      const { role, department_code } = req.user;
      
      let query = '';
      let queryParams = [];

      // NhÃ³m All-Access (ToÃ n quyá»n)
      if (
        role === 'SUPER_ADMIN' || 
        role === 'ADMIN' || // Bá»” SUNG ROLE NÃ€Y NGAY Láº¬P Tá»¨C
        role === 'VICE_PRESIDENT' || 
        (role === 'DEPARTMENT_HEAD' && department_code === 'MARKETING')
      ) {
        query = 'SELECT * FROM ai_chat_sessions ORDER BY timestamp DESC LIMIT 100';
      } else {
        // NhÃ³m Local (Theo phÃ²ng ban/cÆ¡ sá»Ÿ)
        query = `
          SELECT s.* 
          FROM ai_chat_sessions s
          INNER JOIN users u ON s.user_id = u.id::varchar
          WHERE u.department_code = $1
          ORDER BY s.timestamp DESC
          LIMIT 100
        `;
        // Bá»ŒC LÃ“T Lá»–I UNDEFINED TRÃNH CRASH DB
        queryParams = [department_code || 'UNKNOWN'];
      }

      const { rows } = await pool.query(query, queryParams);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error("Lá»—i get AI sessions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai/sessions', authenticateUser, async (req, res) => {
    try {
      const { id, title, chat_log, timestamp } = req.body;
      const insert_user_id = req.user.id;
      const insert_facility = req.user.facility_id || 'ALL';
      
      await pool.query(
        `INSERT INTO ai_chat_sessions (id, user_id, facility, title, chat_log, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET 
         chat_log = EXCLUDED.chat_log, 
         timestamp = EXCLUDED.timestamp,
         title = EXCLUDED.title
         WHERE ai_chat_sessions.user_id = EXCLUDED.user_id`,
        [id, insert_user_id, insert_facility, title, JSON.stringify(chat_log || []), timestamp]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
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
    const task = mockTasks.find(t => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    }

    // 1. TÃ­nh toÃ¡n Tone nháº¯c viá»‡c dá»±a trÃªn Deadline
    const toneEscalation = calculateTone(task.deadline);

    // 2. Gá»i OpenRouter Ä‘á»ƒ sinh ná»™i dung nháº¯c viá»‡c tháº¥u cáº£m theo Tone Ä‘Ã£ tÃ­nh
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
// 4. BÃO CÃO THá»NG KÃŠ TOKEN (DB Váº¬T LÃ)
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
// Táº¦NG RAG SEARCH Káº¾T Há»¢P RBAC FILTERING (VERSION 2 - CHUáº¨N KIáº¾N TRÃšC)
// ==============================================================================
async function searchKnowledgeBase(queryText, user, limit = 3) {
    try {
        // 1. Validate dá»¯ liá»‡u Ä‘áº§u vÃ o cháº·t cháº½
        if (!user || !user.role) {
            throw new Error("ThÃ´ng tin ngÆ°á»i dÃ¹ng khÃ´ng há»£p lá»‡ Ä‘á»ƒ phÃ¢n quyá»n.");
        }

        const queryEmbedding = await generateEmbedding(queryText);
        if (!queryEmbedding) throw new Error("KhÃ´ng thá»ƒ táº¡o vector cho cÃ¢u truy váº¥n.");
        
        const formatEmbedding = `[${queryEmbedding.join(',')}]`;
        const { role, department_code, facility_id } = user;
        
        // 2. PhÃ¢n loáº¡i nhÃ³m All-Access
        const isAllAccess = 
            role === 'SUPER_ADMIN' || 
            role === 'VICE_PRESIDENT' || 
            (role === 'DEPARTMENT_HEAD' && department_code === 'MARKETING');

        // 3. Kiá»ƒm tra an toÃ n cho nhÃ³m Local
        if (!isAllAccess && !department_code && !facility_id) {
            console.error(`CẢNH BÁO BẢO MẬT: Người dùng ${user.id} thiếu cả department_code và facility_id.`);
            throw new Error("Tài khoản của bạn chưa được cấu hình phòng ban hoặc cơ sở. Truy cập bị từ chối.");
        }

        let sql = "";
        let params = [];

        // 4. Tách nhánh Truy vấn sử dụng toán tử JSONB tối ưu (@>)
        if (isAllAccess) {
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
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
                WHERE (metadata @> '{"department_code": "GLOBAL"}'::jsonb)
                   OR ($3::text IS NOT NULL AND metadata @> jsonb_build_object('department_code', $3::text))
                   OR ($4::text IS NOT NULL AND metadata @> jsonb_build_object('facility_id', $4::text))
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;
            params = [formatEmbedding, limit, department_code || null, facility_id || null];
        }
        
        const { rows } = await pool.query(sql, params);
        return rows;
    } catch (error) {
        console.error('searchKnowledgeBase Error:', error);
        throw error;
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
        throw new Error("Lá»—i: MÃ£ phÃ²ng ban/cÆ¡ sá»Ÿ khÃ´ng há»£p lá»‡ hoáº·c bá»‹ trá»‘ng.");
    }

    // 1. RBAC Guardrail: TÃ¡i sá»­ dá»¥ng logic chuáº©n tá»« RAG
    const isAllAccess = 
        user.role === 'SUPER_ADMIN' || 
        user.role === 'VICE_PRESIDENT' || 
        (user.role === 'DEPARTMENT_HEAD' && user.department_code === 'MARKETING');

    if (!isAllAccess) {
        const userDept = normalizeDeptCode(user.department_code || (user.facility_id ? String(user.facility_id) : 'GLOBAL'));
        if (normalizedDept !== userDept) {
            throw new Error(`AI Tá»ª CHá»I: Báº¡n khÃ´ng cÃ³ quyá»n táº¡o task cho phÃ²ng ban [${normalizedDept}]. Tháº©m quyá»n cá»§a báº¡n giá»›i háº¡n táº¡i: [${userDept}].`);
        }
    }

    // 2. Validate Deadline chá»‘ng Crash DB
    let deadlineVal = null;
    if (deadline) {
        const parsedDate = new Date(deadline);
        if (isNaN(parsedDate.getTime())) {
            throw new Error(`Lá»—i: AI truyá»n Ä‘á»‹nh dáº¡ng ngÃ y thÃ¡ng khÃ´ng há»£p lá»‡ (${deadline}). YÃªu cáº§u Ä‘á»‹nh dáº¡ng YYYY-MM-DD.`);
        }
        deadlineVal = parsedDate;
    }

    // 3. Xá»­ lÃ½ logic Facility ID thÃ´ng minh (KhÃ´ng Hardcode)
    let finalFacilityId = user.facility_id;
    
    // Náº¿u All-Access user táº¡o task cho cÆ¡ sá»Ÿ khÃ¡c, tá»± Ä‘á»™ng tra cá»©u ID cá»§a cÆ¡ sá»Ÿ Ä‘Ã³
    if (isAllAccess && normalizedDept !== normalizeDeptCode(user.department_code)) {
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
            title, normalizedDept, deadlineVal, priorityLevel, user.id, finalFacilityId
        ]);
        
        return {
            status: "success",
            message: `Táº¡o cÃ´ng viá»‡c thÃ nh cÃ´ng. ID: ${result.rows[0].id}`
        };
    } catch (error) {
        console.error("Database Error (executeCreateTaskTool):", error);
        throw new Error("Lá»—i há»‡ thá»‘ng khi lÆ°u cÃ´ng viá»‡c vÃ o cÆ¡ sá»Ÿ dá»¯ liá»‡u.");
    }
}

async function executeGetRevenueTool(args, user) {
    const { date_range, facility_code } = args;
    
    const isAllAccess = user.role === 'SUPER_ADMIN' || user.role === 'VICE_PRESIDENT' || (user.role === 'DEPARTMENT_HEAD' && user.department_code === 'MARKETING');
    // Ép kiểu String để tránh lỗi khi so sánh JSONB
    const targetFacility = isAllAccess ? (facility_code ? String(facility_code) : null) : String(user.facility_id);

    // ==============================================================
    // FALLBACK DATE LOGIC: MIỄN NHIỄM VỚI MỌI SAI SÓT TỪ USER/AI
    // ==============================================================
    let startDate, endDate;

    if (date_range && typeof date_range === 'object' && date_range.startDate && date_range.endDate) {
        // AI truyền đúng cấu trúc Object { startDate, endDate }
        startDate = date_range.startDate;
        endDate = date_range.endDate;
    } else if (typeof date_range === 'string' && date_range.includes('-')) {
        // AI truyền chuỗi khoảng thời gian (VD: '2026-05-01 - 2026-05-31' hoặc '01/05/2026-31/05/2026')
        const parts = date_range.split('-');
        startDate = parts[0]?.trim();
        endDate = parts[1]?.trim() || startDate; 
    } else {
        // TRƯỜNG HỢP BẤT TỬ (FALLBACK): AI trả về Null, Undefined, hoặc chuỗi rác
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        
        // Helper xuất chuỗi chuẩn YYYY-MM-DD (ISO) để khớp với regex %-% trong SQL
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
        // LUỒNG 1: All-Access
        // Dynamic Date Parsing cho $1 và $2 để an toàn parse cả ISO lẫn VN format
        sql = `SELECT COALESCE(SUM(total_revenue), 0) AS aggregated_revenue 
               FROM daily_financial_reports 
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= (CASE WHEN $1::text LIKE '%-%' THEN $1::date ELSE to_date($1::text, 'DD/MM/YYYY') END) 
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= (CASE WHEN $2::text LIKE '%-%' THEN $2::date ELSE to_date($2::text, 'DD/MM/YYYY') END)`;
        params = [startDate, endDate];
    } else {
        // LUỒNG 2: Local Group
        // 1. Phẳng hóa dữ liệu JSONB ra ngoài bằng CROSS JOIN LATERAL để giữ Context Mapping
        // 2. Dynamic Date Parsing cho $1 và $2 để an toàn parse cả ISO lẫn VN format
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
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= (CASE WHEN $1::text LIKE '%-%' THEN $1::date ELSE to_date($1::text, 'DD/MM/YYYY') END)
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= (CASE WHEN $2::text LIKE '%-%' THEN $2::date ELSE to_date($2::text, 'DD/MM/YYYY') END)
                 AND (REPLACE(UPPER(item->>'name'), ' ', '') = REPLACE(UPPER($3::text), ' ', '')
                      OR REPLACE(UPPER(item->>'facilityCode'), ' ', '') = REPLACE(UPPER($3::text), ' ', '')
                      OR REPLACE(UPPER(item->>'facilityName'), ' ', '') = REPLACE(UPPER($3::text), ' ', ''))`;
        params = [startDate, endDate, targetFacility];
    }
    try {
        const { rows } = await pool.query(sql, params);
        return {
            status: "success",
            message: `Báo cáo doanh thu của hệ thống/cơ sở [${targetFacility || 'Toàn hệ thống'}] từ ngày ${startDate} đến ${endDate} là: ${Number(rows[0].aggregated_revenue).toLocaleString('vi-VN')} VNĐ.`
        };
    } catch (error) {
        console.error("Revenue DB Error:", error);
        throw new Error("Lỗi hệ thống khi trích xuất doanh thu.");
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
async function getConversationContext(sessionId, userId) {
    if (!sessionId) return [];

    try {
        const authCheckSql = `
            SELECT id FROM ai_chat_sessions 
            WHERE id = $1 AND user_id = $2
        `;
        const { rows: sessionRows } = await pool.query(authCheckSql, [sessionId, userId]);
        
        if (sessionRows.length === 0) {
            console.warn(`[SECURITY ALERT] User ${userId} cá»‘ gáº¯ng truy cáº­p trÃ¡i phÃ©p Session ${sessionId}`);
            throw new Error("403 Forbidden: Báº¡n khÃ´ng cÃ³ quyá» n truy cáº­p vÃ o phiÃªn chat nÃ y!");
        }

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

    } catch (error) {
        console.error("Lá»—i getConversationContext:", error);
        throw error;
    }
}

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
            if (checkSession.rowCount === 0) return res.status(403).json({ error: "Lá»—i phiÃªn lÃ m viá»‡c." });
            
            const saveUserMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`;
            await pool.query(saveUserMsgSql, [session_id, userMessage]);
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
        
        const isLocalUser = req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'VICE_PRESIDENT' && req.user.role !== 'ADMIN';
        
        let finalSystemPrompt = "Báº¡n lÃ  trá»£ lÃ½ áº£o AI Advisor thÃ´ng minh cá»§a há»‡ thá»‘ng TaskFlow." + String.fromCharCode(10) + 
                                  (ragContextText ? "Dá»¯ liá»‡u tham kháº£o:" + String.fromCharCode(10) + ragContextText : "") + 
                                  systemPromptAddition;

        if (isLocalUser) {
            finalSystemPrompt += String.fromCharCode(10) + "LÆ¯U Ã Báº¢O Máº¬T: Báº¡n chá»‰ Ä‘Æ°á»£c tráº£ lá»i cÃ¡c cÃ¢u há»i liÃªn quan sÃ¡t sÆ°á»n Ä‘áº¿n nghiá»‡p vá»¥ phÃ²ng ban cá»§a ngÆ°á»i dÃ¹ng. Náº¿u ngÆ°á»i dÃ¹ng há»i Ä‘Ã¹a, há»i xÃ m, tÃ¡n tá»‰nh hoáº·c há»i cÃ¡c kiáº¿n thá»©c ngoÃ i cÃ´ng viá»‡c, báº¡n Báº®T BUá»˜C pháº£i tráº£ vá» Ä‘Ãºng tá»« khÃ³a: [BLOCK_MISCONDUCT]";
        }

        let chatHistory = [];
        if (session_id) {
            chatHistory = await getConversationContext(session_id, req.user.id);
        }

        const messages = [
            { role: "system", content: finalSystemPrompt },
            ...chatHistory,
            { role: "user", content: userMessage }
        ];

        // ==========================================
        // NHáº¬P 3: SSE STREAMING Vá»šI TOOL CALL
        // ==========================================
        res.setHeader('Content-Type', 'text/event-stream');
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
                                description: "Mã cơ sở cần xem (tùy chọn). Để trống nếu xem toàn hệ thống." 
                            }
                        },
                        required: ["date_range"]
                    }
                }
            }
        ];

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini",
                messages: messages,
                stream: !isLocalUser,
                tools: tools,
                stream_options: !isLocalUser ? { include_usage: true } : undefined
            })
        });

        if (!response.ok) {
            console.error("OpenRouter Stream Error:", await response.text());
            res.write(`data: ${JSON.stringify({ error: "Lá»—i káº¿t ná»‘i AI API" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            return res.end();
        }

        let aiReplyContent = "";
        let promptTokens = 0; 
        let completionTokens = 0;
        let toolCallId = null;
        let toolCallName = null;
        let toolCallArguments = "";

        if (isLocalUser) {
            const data = await response.json();
            if (data.usage) {
                promptTokens = data.usage.prompt_tokens || 0;
                completionTokens = data.usage.completion_tokens || 0;
            }
            if (data.choices && data.choices.length > 0) {
                const msg = data.choices[0].message;
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    const tc = msg.tool_calls[0];
                    if (tc.id) toolCallId = tc.id;
                    if (tc.function && tc.function.name) toolCallName = tc.function.name;
                    if (tc.function && tc.function.arguments) toolCallArguments = tc.function.arguments;
                }
                if (msg.content) {
                    aiReplyContent = msg.content;
                }
            }
            
            // Xá»¬ LÃ BLOCK MISCONDUCT NGAY Láº¬P Tá»¨C
            if (aiReplyContent.includes('[BLOCK_MISCONDUCT]')) {
                await pool.query(`
                    INSERT INTO daily_logs (entry_type, user_id, action_details, created_at)
                    VALUES ($1, $2, $3, NOW())
                `, ['SECURITY_ALERT', req.user.id, `NhÃ¢n viÃªn há»i xÃ m há»‡ thá»‘ng AI. Ná»™i dung: "${userMessage}"`]);
                res.write(`data: ${JSON.stringify({ error: "Há»† THá»NG Cáº¢NH BÃO: CÃ¢u há»i cá»§a báº¡n vi pháº¡m tiÃªu chuáº©n nghiá»‡p vá»¥ ná»™i bá»™. HÃ nh vi nÃ y Ä‘Ã£ Ä‘Æ°á»£c ghi nháº­n vÃ  gá»­i vá» tÃ i khoáº£n Admin Ä‘á»ƒ tiáº¿n hÃ nh truy váº¿t ká»· luáº­t!" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                return res.end();
            }
            
            // Náº¾U Sáº CH Sáº¼, Äáº¨Y Dá»® LIá»†U XUá»NG SSE
            if (aiReplyContent) {
                res.write(`data: ${JSON.stringify({ content: aiReplyContent })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            }
        } else {
            // ADMIN STREAMING (Giá»¯ nguyÃªn)
            let reader = response.body.getReader();
            let decoder = new TextDecoder("utf-8");
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split(String.fromCharCode(10));
                
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
                                if (delta && delta.tool_calls) {
                                    const tc = delta.tool_calls[0];
                                    if (tc.id) toolCallId = tc.id;
                                    if (tc.function && tc.function.name) toolCallName = tc.function.name;
                                    if (tc.function && tc.function.arguments) toolCallArguments += tc.function.arguments;
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
        }

        // ==========================================
        // NHáº¬P 3.5: THá»°C THI TOOL VÃ€ FAIL-FAST
        // ==========================================
        if (toolCallName && toolCallArguments) {
            let args;
            try {
                args = JSON.parse(toolCallArguments);
            } catch (err) {
                console.error("Tool Parse Error (Graceful Degradation):", err.message);
                // Trả về đúng format OpenAI để Frontend phân giải được
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n*Hệ thống: Xin lỗi, tôi không thể xử lý yêu cầu này do AI sinh sai định dạng.*" } }] })}\n\n`);
                res.write(`data: [DONE]\n\n`);
                return res.end();
            }

            try {
                let result;
                if (toolCallName === "create_system_task") {
                    result = await executeCreateTaskTool(args, req.user);
                } else if (toolCallName === "get_revenue_report") {
                    result = await executeGetRevenueTool(args, req.user);
                } else {
                    throw new Error(`Tool ${toolCallName} chưa được hỗ trợ.`);
                }
                const toolResultStr = JSON.stringify(result);
                
                messages.push({
                    role: "assistant",
                    content: aiReplyContent || "",
                    tool_calls: [{
                        id: toolCallId || "call_generated",
                        type: "function",
                        function: { name: toolCallName, arguments: toolCallArguments }
                    }]
                });
                messages.push({
                    role: "tool",
                    tool_call_id: toolCallId || "call_generated",
                    name: toolCallName,
                    content: toolResultStr
                });

                const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({
                        model: "openai/gpt-4o-mini",
                        messages: messages,
                        stream: !isLocalUser,
                        tools: tools,
                        stream_options: !isLocalUser ? { include_usage: true } : undefined
                    })
                });

                if (!response2.ok) {
                    const errorBody = await response2.text();
                    console.error("OpenRouter Fetch 2 Error:", errorBody);
                    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n*Hệ thống: Xin lỗi, AI không thể phân tích kết quả doanh thu lúc này do lỗi kết nối.*" } }] })}\n\n`);
                    res.write(`data: [DONE]\n\n`);
                    return res.end();
                }

                if (isLocalUser) {
                    const data2 = await response2.json();
                    if (data2.usage) {
                        promptTokens += data2.usage.prompt_tokens || 0;
                        completionTokens += data2.usage.completion_tokens || 0;
                    }
                    if (data2.choices && data2.choices.length > 0) {
                        const msg2 = data2.choices[0].message;
                        if (msg2.content) {
                            aiReplyContent += msg2.content;
                            
                            // Xá»¬ LÃ BLOCK Láº¦N 2
                            if (aiReplyContent.includes('[BLOCK_MISCONDUCT]')) {
                                await pool.query(`
                                    INSERT INTO daily_logs (entry_type, user_id, action_details, created_at)
                                    VALUES ($1, $2, $3, NOW())
                                `, ['SECURITY_ALERT', req.user.id, `NhÃ¢n viÃªn há»i xÃ m há»‡ thá»‘ng AI. Ná»™i dung: "${userMessage}"`]);
                                res.write(`data: ${JSON.stringify({ error: "Há»† THá»NG Cáº¢NH BÃO: CÃ¢u há»i cá»§a báº¡n vi pháº¡m tiÃªu chuáº©n nghiá»‡p vá»¥ ná»™i bá»™. HÃ nh vi nÃ y Ä‘Ã£ Ä‘Æ°á»£c ghi nháº­n vÃ  gá»­i vá» tÃ i khoáº£n Admin Ä‘á»ƒ tiáº¿n hÃ nh truy váº¿t ká»· luáº­t!" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                return res.end();
                            }

                            res.write(`data: ${JSON.stringify({ content: msg2.content })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                        }
                    }
                } else {
                    let reader2 = response2.body.getReader();
                    let decoder2 = new TextDecoder("utf-8");
                    while (true) {
                        const { done, value } = await reader2.read();
                        if (done) break;
                        const chunk = decoder2.decode(value, { stream: true });
                        const lines = chunk.split(String.fromCharCode(10));
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
                }
            } catch (err) {
                console.error("Tool Execution Error:", err.message);
                res.write(`data: ${JSON.stringify({ error: err.message })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                return res.end();
            }
        }

        // Káº¿t thÃºc luá»“ng stream an toÃ n
        if (!res.writableEnded) {
            res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            res.end();
        }

        // ==========================================
        // NHáº¬P 4: LÆ¯U DB & GHI LOG Báº¢O Máº¬T
        // ==========================================
        if (session_id && aiReplyContent) {
            try {
                const saveAiMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`;
                await pool.query(saveAiMsgSql, [session_id, aiReplyContent]);
            } catch (innerErr) {
                // Graceful Degradation: Bỏ qua lỗi thiếu bảng, cho phép luồng Chat tiếp tục
                console.warn("Failed to save chat message: Table missing", innerErr.message);
            }
        }

        if (promptTokens > 0 || completionTokens > 0) {
            const totalTokens = promptTokens + completionTokens;
            // Ghi log token vào đúng phiên chat hiện tại
            // Commenting out metadata logic because column does not exist yet in DB
            // await pool.query(
            //     `UPDATE ai_chat_sessions 
            //      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{tokens}', jsonb_build_object('total', $1::int))
            //      WHERE id = $2`,
            //     [totalTokens, session_id]
            // );
        }

    } catch (error) {
        console.error("AI Chat Stream error:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Lá»—i há»‡ thá»‘ng AI Chat." });
        } else {
            res.end();
        }
    }
});
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



