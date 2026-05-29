import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_api = """  app.get('/api/ai/sessions', authenticateUser, checkAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM ai_chat_sessions ORDER BY timestamp DESC LIMIT 50');
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });"""

new_api = """  app.get('/api/ai/sessions', authenticateUser, checkAdmin, async (req, res) => {
    try {
      const { role, department_code } = req.user;
      
      let query = '';
      let queryParams = [];

      // Nhóm All-Access (Toàn quyền)
      if (
        role === 'SUPER_ADMIN' || 
        role === 'VICE_PRESIDENT' || 
        (role === 'DEPARTMENT_HEAD' && department_code === 'MARKETING')
      ) {
        query = 'SELECT * FROM ai_chat_sessions ORDER BY timestamp DESC LIMIT 100';
      } else {
        // Nhóm Local (Theo phòng ban/cơ sở)
        query = `
          SELECT s.* 
          FROM ai_chat_sessions s
          INNER JOIN users u ON s.user_id = u.id::varchar
          WHERE u.department_code = $1
          ORDER BY s.timestamp DESC
          LIMIT 100
        `;
        queryParams = [department_code];
      }

      const { rows } = await pool.query(query, queryParams);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error("Lỗi get AI sessions:", error);
      res.status(500).json({ error: error.message });
    }
  });"""

text = text.replace(old_api, new_api)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("API /api/ai/sessions patched successfully.")
