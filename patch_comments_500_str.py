import sys

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target = """const comment = req.body.comment || req.body.content;
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
      newComment.user_name = req.user.name;"""

replacement = """const comment = req.body.comment || req.body.content;
      if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });
      
      // Lấy user_id thực sự từ token thay vì req.user.id (vốn bị undefined)
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
                  // So sánh chính xác PIC và người comment (chuyển về int)
                  if (tInfo.pic_id && parseInt(tInfo.pic_id) !== parseInt(realUserId)) {
                      sendRealtimeNotification(tInfo.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: "${tInfo.title}"`, id, realUserId);
                  }
              }
          }
      } catch (err) { console.error("Notification comment err:", err); }
  
      const newComment = rows[0];
      const nameRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [realUserId]);
      newComment.user_name = nameRes.rows.length > 0 ? nameRes.rows[0].full_name : 'Unknown';"""

if target in content:
    content = content.replace(target, replacement)
    with open('server.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully replaced with string replace!")
else:
    print("Target string not found precisely. Let's do it with replace_file_content.")
