import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Add normalizeDept
if "const normalizeDept =" not in text:
    text = text.replace("const authenticateUser =", """const normalizeDept = (code) => {
    if (!code) return '';
    let normalized = code.toString().trim().toUpperCase();
    normalized = normalized.replace(/^PHÒNG\s+/i, '').replace(/^PHONG\s+/i, '');
    if (normalized === 'MKT') return 'MARKETING';
    return normalized;
};

const authenticateUser =""")

# 2. Patch POST /api/tasks
old_post = """app.post('/api/tasks', authenticateUser, async (req, res) => {
    try {
      const { title, desc, pic, deadline, status, urgent, facility } = req.body;"""
new_post = """app.post('/api/tasks', authenticateUser, async (req, res) => {
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
"""
if old_post in text:
    text = text.replace(old_post, new_post)
else:
    print("WARNING: POST patch failed.")

# 3. Patch INSERT INTO tasks
old_insert = """    const insertQuery = `
      INSERT INTO tasks (title, description, status, urgency, deadline, pic_id, facility_id, priority_level, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
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
        urgent ? 'URGENT' : 'PRIORITY'
      ]);"""
new_insert = """    const insertQuery = `
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
      ]);"""
if old_insert in text:
    text = text.replace(old_insert, new_insert)
else:
    print("WARNING: INSERT patch failed.")

# 4. Patch AI Ping
old_aiping = """    const logEntry = {
      id: mockAiPingLogs.length + 1,
      task_id: task.id,
      pic_name: task.pic_name,
      tone_level: toneEscalation.level,
      message: pingMessage,
      created_at: new Date().toISOString()
    };
    mockAiPingLogs.push(logEntry);"""
new_aiping = """    await pool.query('INSERT INTO ai_ping_logs (task_id, message) VALUES ($1, $2)', [task.id, pingMessage]);
    const logEntry = {
      task_id: task.id,
      message: pingMessage,
      created_at: new Date().toISOString()
    };"""
if old_aiping in text:
    text = text.replace(old_aiping, new_aiping)
else:
    print("WARNING: AI Ping patch failed.")

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("server.js updated.")
