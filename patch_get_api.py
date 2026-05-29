import re

filepath = 'server.js'
with open(filepath, 'r', encoding='utf-8') as f:
    text = f.read()

old_get_api = """app.get('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT c.*, u.name as user_name, u.role as user_role 
      FROM task_comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.task_id = $1 
      ORDER BY c.created_at ASC
    `, [id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải bình luận.' });
  }
});"""

new_get_api = """app.get('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
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
});"""

text = text.replace(old_get_api, new_get_api)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(text)

print("server.js updated GET API.")
