import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch'; 
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

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
app.use(cors());
app.use(express.json());

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

// Báº£ng Check-in Äáº§u giá»
const mockCheckins = [];

let mockFacilities = [
  { id: 'f1', name: 'DUBAI 41', is_active: true },
  { id: 'f2', name: 'DUBAI ACE', is_active: true },
  { id: 'f3', name: 'DUBAI PA', is_active: true },
  { id: 'f4', name: 'DUBAI PAK', is_active: true },
  { id: 'f5', name: 'DUBAI PAV', is_active: true },
  { id: 'f6', name: 'DUBAI PHÃš QUá»C', is_active: true }
];

app.get('/api/facilities', (req, res) => {
  res.json({ success: true, data: mockFacilities });
});

app.post('/api/facilities', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'TÃªn cÆ¡ sá»Ÿ khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng.' });
  const newFac = {
    id: 'f' + Date.now(),
    name: name.trim().toUpperCase(),
    is_active: true
  };
  mockFacilities.push(newFac);
  res.json({ success: true, data: newFac });
});

app.put('/api/facilities/:id/archive', (req, res) => {
  const { id } = req.params;
  const fac = mockFacilities.find(f => f.id === id);
  if (!fac) return res.status(404).json({ error: 'CÆ¡ sá»Ÿ khÃ´ng tá»“n táº¡i.' });
  fac.is_active = false;
  res.json({ success: true, data: fac });
});

app.put('/api/facilities/:id/restore', (req, res) => {
  const { id } = req.params;
  const fac = mockFacilities.find(f => f.id === id);
  if (!fac) return res.status(404).json({ error: 'CÆ¡ sá»Ÿ khÃ´ng tá»“n táº¡i.' });
  fac.is_active = true;
  res.json({ success: true, data: fac });
});

const authenticateUser = async (req, res, next) => {
    try {
        const userRole = req.headers['x-user-role']; 
        const facilityRaw = req.headers['x-facility-id'];
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
      
        req.user = { role: userRole, facility_id: facilityId };
        next();
    } catch (err) {
        console.error("Auth middleware error:", err);
        return res.status(500).json({ error: 'Lá»—i xÃ¡c thá»±c ná»™i bá»™.' });
    }
};


// Soft delete user
app.delete('/api/users/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.user;
    if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
        return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá» n' });
    }
    
    // Hard delete - delete all associated records first to avoid foreign key constraints
    await pool.query('DELETE FROM task_comments WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM ai_ping_logs WHERE pic_id = $1', [id]);
    await pool.query('DELETE FROM daily_checkins WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM ai_token_usage_logs WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM tasks WHERE pic_id = $1', [id]);
    
    // Finally delete the user
    const deleteQuery = 'DELETE FROM users WHERE id = $1 RETURNING *';
    const { rows } = await pool.query(deleteQuery, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y tÃ i khoáº£n.' });
    }
    
    res.json({ success: true, message: 'Ä Ã£ xÃ³a tÃ i khoáº£n thÃ nh cÃ´ng.' });
  } catch (error) {
    console.error('Lỗi xóa tài khoản:', error);
    res.status(500).json({ error: 'DEBUG_MARKER: ' + (error.message || 'Lỗi server khi xóa tài khoản.') });
  }
});

app.get('/api/users/directory', authenticateUser, async (req, res) => {
  try {
    const { rows: users } = await pool.query('SELECT id AS user_id, email, full_name, role_id, facility_id FROM users');
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Lá»—i láº¥y danh báº¡:", error);
    res.status(500).json({ error: 'Lá»—i server.' });
  }
});

app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    console.log("Header nháº­n Ä‘Æ°á»£c:", req.headers);
    const { role, facility_id } = req.user;
    
    let query = `
      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt", t.created_by_role as "creator_role",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId",
             (SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count,
             (SELECT content FROM task_comments WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_comment,
             (SELECT user_id FROM task_comments WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_comment_user_id
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id
      WHERE 1=1
    `;
      const params = [];
      if (role === 'FACILITY_MANAGER') {
        if (!facility_id || facility_id === 'ALL') {
            return res.status(403).json({ error: "Lá»—i phÃ¢n quyá»n: KhÃ´ng xÃ¡c Ä‘á»‹nh Ä‘Æ°á»£c cÆ¡ sá»Ÿ há»£p lá»‡." });
        }
        params.push(facility_id);
        query += ` AND t.facility_id = $${params.length}`;
      } else if (facility_id && facility_id !== 'ALL') {
        params.push(facility_id);
        query += ` AND t.facility_id = $${params.length}`;
      }
      
      query += ` ORDER BY t.created_at DESC`;

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
    
    const updateQuery = `
      UPDATE tasks 
      SET status = $1, 
          updated_at = NOW() 
      WHERE id = $2 
      RETURNING id, title, description as desc, status, urgency as urgent, TO_CHAR(deadline, 'YYYY-MM-DD') as deadline, created_at as "createdAt"
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

app.post('/api/tasks', authenticateUser, async (req, res) => {
  try {
    console.log("Payload táº¡o task:", req.body);
    const { title, desc, pic, deadline, status, urgent, facility, creator_role } = req.body;
    
    let pic_id = null;
    let pic_facility_id = null;
    if (pic) {
        const picUser = await pool.query('SELECT id, facility_id FROM users WHERE username = $1 OR full_name = $1 OR email = $1 LIMIT 1', [pic]);
        if (picUser.rows.length > 0) {
            pic_id = picUser.rows[0].id;
            pic_facility_id = picUser.rows[0].facility_id;
        }
    }
  
    let insert_facility_id = null;
    if (req.user.role === 'FACILITY_MANAGER') {
        insert_facility_id = req.user.facility_id;
    } else {
        if (facility && facility !== 'HQ' && facility !== 'ALL') {
            let parsedFac = parseInt(facility, 10);
            if (!isNaN(parsedFac)) {
                insert_facility_id = parsedFac;
            } else {
                const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [facility]);
                if (facRecord.rows.length > 0) {
                    insert_facility_id = facRecord.rows[0].id;
                } else if (['MARKETING', 'BGD', 'FINANCE'].includes(facility)) {
                    const newFac = await pool.query("INSERT INTO facilities (name, code) VALUES ($1, $1) RETURNING id", [facility]);
                    insert_facility_id = newFac.rows[0].id;
                }
            }
        } else if (pic_facility_id) {
            insert_facility_id = pic_facility_id;
        }
    }

    // FALLBACK: If insert_facility_id is still null (due to 'ALL', 'HQ', or unmapped facility name like 'DB41')
    if (!insert_facility_id || insert_facility_id === 'ALL') {
          const userRole = req.user.role;
          let deptFacCode = null;
          if (userRole === 'DEPARTMENT_HEAD') deptFacCode = 'MARKETING';
          else if (userRole === 'FINANCE_DEPT') deptFacCode = 'FINANCE';
          else if (userRole === 'VICE_PRESIDENT') deptFacCode = 'BGD';


          if (deptFacCode) {
              const facRecord = await pool.query('SELECT id FROM facilities WHERE code =  OR name =  LIMIT 1', [deptFacCode]);
              if (facRecord.rows.length > 0) {
                  insert_facility_id = facRecord.rows[0].id;
              } else {
                  const newFac = await pool.query("INSERT INTO facilities (name, code) VALUES (, ) RETURNING id", [deptFacCode]);
                  insert_facility_id = newFac.rows[0].id;
              }
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
      INSERT INTO tasks (title, description, status, urgency, deadline, pic_id, facility_id, priority_level, created_by_role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id, title, description as desc, status, urgency as urgent, TO_CHAR(deadline, 'YYYY-MM-DD') as deadline, created_at as "createdAt"
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
          req.user.role
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
app.delete('/api/tasks/all', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
       return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá»n' });
    }
    await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    res.json({ success: true, message: 'ÄÃ£ xÃ³a táº¥t cáº£ tasks' });
  } catch (error) {
    console.error("Lá»—i xÃ³a tasks:", error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ khi xÃ³a tasks' });
  }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; // Changed from email to username
    
    // Hardcode tÃ i khoáº£n Ä‘á»ƒ demo
    if (username === 'admin' && password === 'admin123') {
      return res.json({
        success: true,
        token: 'mock-jwt-token-admin',
        user: { name: 'Sáº¿p Tá»•ng', role: 'SUPER_ADMIN', facility_id: 'ALL' }
      });
    } else if (username === 'manager1' && password === 'manager123') {
      return res.json({
        success: true,
        token: 'mock-jwt-token-manager',
        user: { name: 'Quáº£n lÃ½ CÆ¡ sá»Ÿ 1', role: 'FACILITY_MANAGER', facility_id: 'CÆ¡ sá»Ÿ 1' } // Giá»¯ kiá»ƒu string 'CÆ¡ sá»Ÿ 1' cho khá»›p vá»›i frontend mock
      });
    }
  
    try {
        const { rows } = await pool.query(`
            SELECT u.*, r.name AS role_name, f.code AS facility_code 
            FROM users u 
            LEFT JOIN roles r ON u.role_id = r.id 
            LEFT JOIN facilities f ON u.facility_id = f.id
            WHERE u.email = $1 OR u.full_name = $1
        `, [username]);
        if (rows.length > 0) {
            const user = rows[0];
            const passToCheck = user.password || user.password_hash;
            if (passToCheck === password || passToCheck === Buffer.from(password).toString('base64') || Buffer.from(passToCheck || '').toString('base64') === password) {
                return res.json({
                    success: true,
                    token: 'jwt-token-' + user.id,
                    user: { 
                        name: user.full_name, 
                        role: user.role_name, 
                        facility_id: user.facility_id || 'ALL',
                        facility_code: user.facility_code || ''
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

app.post('/api/checkin', authenticateUser, (req, res) => {
  const { role, facility_id } = req.user;
  
  if (role !== 'FACILITY_MANAGER') {
    return res.status(403).json({ error: 'Chá»‰ Quáº£n lÃ½ cÆ¡ sá»Ÿ má»›i Ä‘Æ°á»£c phÃ©p Check-in.' });
  }

  const checkinData = {
    id: mockCheckins.length + 1,
    facility_id,
    date: new Date().toISOString().split('T')[0], // LÆ°u theo ngÃ y
    timestamp: new Date().toISOString(),
    ...req.body
  };

  mockCheckins.push(checkinData);
  res.json({ success: true, message: 'Check-in thÃ nh cÃ´ng', isCheckinCompleted: true, data: checkinData });
});

app.get('/api/checkin/status', authenticateUser, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { role, facility_id } = req.user;
  
  const facilities = ['CÆ¡ sá»Ÿ 1', 'CÆ¡ sá»Ÿ 2'];
  const targetFacilities = role === 'FACILITY_MANAGER' ? [facility_id] : facilities;

  const statusList = targetFacilities.map(fac => {
    const checkins = mockCheckins.filter(c => c.facility_id === fac && c.date === today);
    const ca1 = checkins.find(c => c.shift === 'Ca 1');
    const ca2 = checkins.find(c => c.shift === 'Ca 2');
    return {
      facility_id: fac,
      ca1: ca1 ? 'ÄÃ£ bÃ¡o cÃ¡o' : 'ChÆ°a bÃ¡o cÃ¡o',
      ca2: ca2 ? 'ÄÃ£ bÃ¡o cÃ¡o' : 'ChÆ°a bÃ¡o cÃ¡o',
      details: checkins
    };
  });

  res.json({ success: true, data: statusList });
});

// ==============================================================================
// 2. AUTO-TASKING AI (TÃCH Há»¢P OPENROUTER)
// ==============================================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-v1-xxxxxxxxxxxx'; 

app.post('/api/ai/auto-tasking', authenticateUser, async (req, res) => {
  try {
    const { meetingTranscript, facilityId } = req.body;

    if (!meetingTranscript) {
      return res.status(400).json({ error: 'Vui lÃ²ng cung cáº¥p biÃªn báº£n cuá»™c há»p.' });
    }

    const systemPrompt = `Báº¡n lÃ  má»™t AI Äiá»u phá»‘i CÃ´ng viá»‡c xuáº¥t sáº¯c. Nhiá»‡m vá»¥: Äá»c biÃªn báº£n cuá»™c há»p vÃ  tá»± Ä‘á»™ng trÃ­ch xuáº¥t cÃ¡c cÃ´ng viá»‡c cáº§n lÃ m thÃ nh Ä‘á»‹nh dáº¡ng JSON strict.
TrÃ­ch xuáº¥t máº£ng "tasks" vá»›i cáº¥u trÃºc: "task_title", "pic", "deadline" (YYYY-MM-DD), "target_facility" (TÃªn cÆ¡ sá»Ÿ, vÃ­ dá»¥: CÆ¡ sá»Ÿ 1), "priority_level" (QuÃ©t vÄƒn báº£n: Náº¿u cÃ³ 'kháº©n cáº¥p', 'gáº¥p', 'ngay', 'há»a tá»‘c' -> 'URGENT'. Náº¿u khÃ´ng -> 'PRIORITY').`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "meta-llama/llama-3-8b-instruct",
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

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "meta-llama/llama-3-8b-instruct",
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
    const logEntry = {
      id: mockAiPingLogs.length + 1,
      task_id: task.id,
      pic_name: task.pic_name,
      tone_level: toneEscalation.level,
      message: pingMessage,
      created_at: new Date().toISOString()
    };
    mockAiPingLogs.push(logEntry);

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
    if (!['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'FACILITY_MANAGER'].includes(role)) {
      return res.status(403).json({ error: 'KhÃ´ng Ä‘á»§ quyá»n xem bÃ¡o cÃ¡o tÃ i chÃ­nh.' });
    }
    const { rows } = await pool.query('SELECT * FROM daily_financial_reports ORDER BY date DESC');
    res.json({ success: true, data: rows });
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


// GET comments for a task
app.get('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const query = 
      SELECT c.*, u.full_name as author_name, u.role_id, u.email, u.username
      FROM task_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.task_id = 
      ORDER BY c.created_at ASC
    ;
    const { rows } = await pool.query(query, [id]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Lỗi lấy bình luận:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy bình luận.' });
  }
});

// POST a new comment
app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const user_id = req.user.id;
    
    if (!content) return res.status(400).json({ error: 'Nội dung bình luận không được trống.' });
    
    const query = 
      INSERT INTO task_comments (task_id, user_id, content)
      VALUES (, , )
      RETURNING *
    ;
    const { rows } = await pool.query(query, [id, user_id, content]);
    
    // Also update task updated_at to trigger polling refresh
    await pool.query('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ', [id]);
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Lỗi tạo bình luận:', error);
    res.status(500).json({ error: 'Lỗi server khi tạo bình luận.' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  try {

    await pool.query(
      CREATE TABLE IF NOT EXISTS task_comments (
          id SERIAL PRIMARY KEY,
          task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    );
    console.log('[DB] Đã kiểm tra/tạo bảng task_comments');
  } catch(e) {
    console.error('[DB] Lỗi tạo bảng task_comments:', e);
  }

  console.log(`ðŸš€ TaskFlow AI Server Ä‘ang cháº¡y táº¡i http://localhost:${PORT}`);
  console.log(`[DB] DATABASE_URL: ${process.env.DATABASE_URL ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_HOST: ${process.env.DB_HOST ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_NAME: ${process.env.DB_NAME ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_USER: ${process.env.DB_USER ? 'OK' : 'UNDEFINED'}`);
  console.log(`[DB] DB_PORT: ${process.env.DB_PORT ? 'OK' : 'UNDEFINED'}`);
  console.log(`[API] SUPABASE_KEY: ${process.env.SUPABASE_KEY ? 'OK' : 'UNDEFINED'}`);
});




