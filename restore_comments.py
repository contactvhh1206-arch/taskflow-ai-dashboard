import sys

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add table
table_target = """    // Notifications table"""
table_replacement = """    // Comments table
    await pool.query(`CREATE TABLE IF NOT EXISTS task_comments (
        id SERIAL PRIMARY KEY,
        task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    // Notifications table"""
if table_target in content:
    content = content.replace(table_target, table_replacement)

# 2. Add routes before POST /api/tasks (around line 530)
# Let's find "app.post('/api/tasks', authenticateUser"
api_target = "app.post('/api/tasks', authenticateUser"
api_replacement = """
app.get('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
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
});

app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });

    const { rows } = await pool.query(`
      INSERT INTO task_comments (task_id, user_id, comment)
      VALUES ($1, $2, $3) RETURNING *
    `, [id, req.user.id, comment]);
    
    // [NOTIFICATIONS TRIGGER]
    try {
        if (typeof sendRealtimeNotification === 'function') {
            const taskInfo = await pool.query('SELECT pic_id, title FROM tasks WHERE id = $1', [id]);
            if (taskInfo.rows.length > 0) {
                const tInfo = taskInfo.rows[0];
                if (tInfo.pic_id && tInfo.pic_id !== req.user.id) {
                    sendRealtimeNotification(tInfo.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: "${tInfo.title}"`, id, req.user.id);
                }
            }
        }
    } catch (err) { console.error("Notification comment err:", err); }

    const newComment = rows[0];
    newComment.user_name = req.user.name; // Simplified, in real world we need to query user name or pass it
    res.json({ success: true, data: newComment });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thêm bình luận.' });
  }
});

app.post('/api/tasks', authenticateUser"""
if api_target in content:
    content = content.replace(api_target, api_replacement)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Restored comments API in server.js")
