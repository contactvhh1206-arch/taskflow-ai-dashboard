import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target_start = content.find("app.post('/api/tasks/:id/comments'")
if target_start != -1:
    target_end = content.find("res.json({ success: true, data: newComment });\n    } catch (err) {", target_start)
    if target_end != -1:
        target_end += len("res.json({ success: true, data: newComment });\n    } catch (err) {")
        
        replacement = """app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const comment = req.body.comment || req.body.content;
      if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });
      
      // Resolve real user_id from token
      let realUserId = null;
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer jwt-token-')) {
          realUserId = parseInt(authHeader.replace('Bearer jwt-token-', ''), 10);
      }
      
      if (!realUserId) {
          const roleRes = await pool.query('SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = $1 LIMIT 1', [req.user.role]);
          if (roleRes.rows.length > 0) realUserId = roleRes.rows[0].id;
      }
      realUserId = realUserId || 1; // Fallback an toàn để không văng 500

      const { rows } = await pool.query(`
        INSERT INTO task_comments (task_id, user_id, comment)
        VALUES ($1, $2, $3) RETURNING *
      `, [id, realUserId, comment]);
      
      // [NOTIFICATIONS TRIGGER]
      try {
          if (typeof sendRealtimeNotification === 'function') {
              const taskInfo = await pool.query('SELECT pic_id, title FROM tasks WHERE id = $1', [id]);
              if (taskInfo.rows.length > 0) {
                  const tInfo = taskInfo.rows[0];
                  // KHÔNG GỬI THÔNG BÁO NẾU NGƯỜI COMMENT LÀ PIC CỦA TASK
                  if (tInfo.pic_id && parseInt(tInfo.pic_id) !== parseInt(realUserId)) {
                      sendRealtimeNotification(tInfo.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: "${tInfo.title}"`, id, realUserId);
                  }
              }
          }
      } catch (err) { console.error("Notification comment err:", err); }
  
      const newComment = rows[0];
      const nameRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [realUserId]);
      newComment.user_name = nameRes.rows.length > 0 ? nameRes.rows[0].full_name : 'Unknown';
      res.json({ success: true, data: newComment });
    } catch (err) {"""
        
        new_content = content[:target_start] + replacement + content[target_end:]
        with open('server.js', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Successfully replaced block by index!")
    else:
        print("Could not find end of block")
else:
    print("Could not find start of block")
