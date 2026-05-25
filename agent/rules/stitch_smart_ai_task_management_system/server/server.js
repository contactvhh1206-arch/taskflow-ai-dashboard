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
// 1. MOCK DATABASE & MIDDLEWARE PHÂN QUYỀN (RBAC)
// ==============================================================================

const mockTasks = [
  { id: 1, title: 'Bảo trì máy lạnh', facility_id: 1, pic_id: 2, pic_name: 'Trần Thị B', status: 'todo', deadline: '2026-05-15' },
  { id: 2, title: 'Nghiệm thu KPI', facility_id: 2, pic_id: 3, pic_name: 'Lê Văn C', status: 'review', deadline: '2026-05-12' }, // Trễ 2 ngày
  { id: 3, title: 'Lên chiến dịch Ads', facility_id: 'ALL', pic_id: 4, pic_name: 'Phạm D', status: 'in_progress', deadline: '2026-05-10' } // Trễ 4 ngày
];

// Bảng Log Nhắc việc AI (Công khai cho Sếp Tổng / Tổng quản lý)
const mockAiPingLogs = [];

// Bảng Check-in Đầu giờ
const mockCheckins = [];

let mockFacilities = [
  { id: 'f1', name: 'DUBAI 41', is_active: true },
  { id: 'f2', name: 'DUBAI ACE', is_active: true },
  { id: 'f3', name: 'DUBAI PA', is_active: true },
  { id: 'f4', name: 'DUBAI PAK', is_active: true },
  { id: 'f5', name: 'DUBAI PAV', is_active: true },
  { id: 'f6', name: 'DUBAI PHÚ QUỐC', is_active: true }
];

app.get('/api/facilities', (req, res) => {
  res.json({ success: true, data: mockFacilities });
});

app.post('/api/facilities', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Tên cơ sở không được để trống.' });
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
  if (!fac) return res.status(404).json({ error: 'Cơ sở không tồn tại.' });
  fac.is_active = false;
  res.json({ success: true, data: fac });
});

app.put('/api/facilities/:id/restore', (req, res) => {
  const { id } = req.params;
  const fac = mockFacilities.find(f => f.id === id);
  if (!fac) return res.status(404).json({ error: 'Cơ sở không tồn tại.' });
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
        return res.status(500).json({ error: 'Lỗi xác thực nội bộ.' });
    }
};

app.get('/api/users/directory', authenticateUser, async (req, res) => {
  try {
    const { rows: users } = await pool.query('SELECT id AS user_id, email, full_name, role_id, facility_id FROM users');
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Lỗi lấy danh bạ:", error);
    res.status(500).json({ error: 'Lỗi server.' });
  }
});

app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    console.log("Header nhận được:", req.headers);
    const { role, facility_id } = req.user;
    
    let query = `
      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId"
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id
      WHERE 1=1
    `;
      const params = [];
      if (role === 'FACILITY_MANAGER') {
        if (!facility_id || facility_id === 'ALL') {
            return res.status(403).json({ error: "Lỗi phân quyền: Không xác định được cơ sở hợp lệ." });
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
      RETURNING id, title, description as desc, status, urgency as urgent, TO_CHAR(deadline, 'YYYY-MM-DD') as deadline, created_at as "createdAt"
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

app.post('/api/tasks', authenticateUser, async (req, res) => {
  try {
    console.log("Payload tạo task:", req.body);
    const { title, desc, pic, deadline, status, urgent, facility } = req.body;
    
    let pic_id = null;
    if (pic) {
        const picUser = await pool.query('SELECT id FROM users WHERE full_name = $1 OR email = $1 LIMIT 1', [pic]);
        if (picUser.rows.length > 0) pic_id = picUser.rows[0].id;
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
                if (facRecord.rows.length > 0) insert_facility_id = facRecord.rows[0].id;
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
      INSERT INTO tasks (title, description, status, urgency, deadline, pic_id, facility_id, priority_level, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
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
        urgent ? 'URGENT' : 'PRIORITY'
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
app.delete('/api/tasks/all', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
       return res.status(403).json({ error: 'Không đủ quyền' });
    }
    await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    res.json({ success: true, message: 'Đã xóa tất cả tasks' });
  } catch (error) {
    console.error("Lỗi xóa tasks:", error);
    res.status(500).json({ error: 'Lỗi máy chủ khi xóa tasks' });
  }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; // Changed from email to username
    
    // Hardcode tài khoản để demo
    if (username === 'admin' && password === 'admin123') {
      return res.json({
        success: true,
        token: 'mock-jwt-token-admin',
        user: { name: 'Sếp Tổng', role: 'SUPER_ADMIN', facility_id: 'ALL' }
      });
    } else if (username === 'manager1' && password === 'manager123') {
      return res.json({
        success: true,
        token: 'mock-jwt-token-manager',
        user: { name: 'Quản lý Cơ sở 1', role: 'FACILITY_MANAGER', facility_id: 'Cơ sở 1' } // Giữ kiểu string 'Cơ sở 1' cho khớp với frontend mock
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

app.post('/api/checkin', authenticateUser, (req, res) => {
  const { role, facility_id } = req.user;
  
  if (role !== 'FACILITY_MANAGER') {
    return res.status(403).json({ error: 'Chỉ Quản lý cơ sở mới được phép Check-in.' });
  }

  const checkinData = {
    id: mockCheckins.length + 1,
    facility_id,
    date: new Date().toISOString().split('T')[0], // Lưu theo ngày
    timestamp: new Date().toISOString(),
    ...req.body
  };

  mockCheckins.push(checkinData);
  res.json({ success: true, message: 'Check-in thành công', isCheckinCompleted: true, data: checkinData });
});

app.get('/api/checkin/status', authenticateUser, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { role, facility_id } = req.user;
  
  const facilities = ['Cơ sở 1', 'Cơ sở 2'];
  const targetFacilities = role === 'FACILITY_MANAGER' ? [facility_id] : facilities;

  const statusList = targetFacilities.map(fac => {
    const checkins = mockCheckins.filter(c => c.facility_id === fac && c.date === today);
    const ca1 = checkins.find(c => c.shift === 'Ca 1');
    const ca2 = checkins.find(c => c.shift === 'Ca 2');
    return {
      facility_id: fac,
      ca1: ca1 ? 'Đã báo cáo' : 'Chưa báo cáo',
      ca2: ca2 ? 'Đã báo cáo' : 'Chưa báo cáo',
      details: checkins
    };
  });

  res.json({ success: true, data: statusList });
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

    const systemPrompt = `Bạn là một AI Điều phối Công việc xuất sắc. Nhiệm vụ: Đọc biên bản cuộc họp và tự động trích xuất các công việc cần làm thành định dạng JSON strict.
Trích xuất mảng "tasks" với cấu trúc: "task_title", "pic", "deadline" (YYYY-MM-DD), "target_facility" (Tên cơ sở, ví dụ: Cơ sở 1), "priority_level" (Quét văn bản: Nếu có 'khẩn cấp', 'gấp', 'ngay', 'hỏa tốc' -> 'URGENT'. Nếu không -> 'PRIORITY').`;

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
    let pingMessage = "Đã xảy ra lỗi sinh nội dung nhắc việc.";
    
    if (aiData.choices && aiData.choices.length > 0) {
      pingMessage = aiData.choices[0].message.content.trim();
    }

    // 3. Ghi vào "Bảng Log Nhắc việc AI" công khai
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
    if (!['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(role)) {
      return res.status(403).json({ error: 'Không đủ quyền xem báo cáo tài chính.' });
    }
    const { rows } = await pool.query('SELECT * FROM daily_financial_reports ORDER BY date DESC');
    res.json({ success: true, data: rows });
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

