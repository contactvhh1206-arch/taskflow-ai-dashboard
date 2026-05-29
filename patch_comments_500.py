import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target_pattern = r"const comment = req\.body\.comment \|\| req\.body\.content;\n\s*if \(\!comment\) return res\.status\(400\)\.json\(\{ error: 'Nội dung bình luận trống' \}\);\n\n\s*const \{ rows \} = await pool\.query\(`\n\s*INSERT INTO task_comments \(task_id, user_id, comment\)\n\s*VALUES \(\$1, \$2, \$3\) RETURNING \*\n\s*`, \[id, req\.user\.id, comment\]\);\n\s*// \[NOTIFICATIONS TRIGGER\]\n\s*try \{\n\s*if \(typeof sendRealtimeNotification === 'function'\) \{\n\s*const taskInfo = await pool\.query\('SELECT pic_id, title FROM tasks WHERE id = \$1', \[id\]\);\n\s*if \(taskInfo\.rows\.length > 0\) \{\n\s*const tInfo = taskInfo\.rows\[0\];\n\s*if \(tInfo\.pic_id && tInfo\.pic_id !== req\.user\.id\) \{\n\s*sendRealtimeNotification\(tInfo\.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: \"\$\{tInfo\.title\}\"`, id, req\.user\.id\);\n\s*\}\n\s*\}\n\s*\}\n\s*\} catch \(err\) \{ console\.error\(\"Notification comment err:\", err\); \}\n\n\s*const newComment = rows\[0\];\n\s*newComment\.user_name = req\.user\.name;"

replacement = r"""const comment = req.body.comment || req.body.content;
      if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });
  
      // Resolve real user_id from token
      let realUserId = null;
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer jwt-token-')) {
          realUserId = parseInt(authHeader.replace('Bearer jwt-token-', ''));
      }
      if (!realUserId) {
          const roleRes = await pool.query('SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = $1 LIMIT 1', [req.user.role]);
          if (roleRes.rows.length > 0) realUserId = roleRes.rows[0].id;
      }
      realUserId = realUserId || 1; // Fallback an toàn

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
      
      // Lấy tên hiển thị
      const nameRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [realUserId]);
      newComment.user_name = nameRes.rows.length > 0 ? nameRes.rows[0].full_name : 'Unknown';"""

if re.search(target_pattern, content):
    content = re.sub(target_pattern, replacement, content, count=1)
    with open('server.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully patched POST comments")
else:
    print("Pattern not found!")
    # Let's try an alternative string replace to be safe
    target = """const comment = req.body.comment || req.body.content;
      if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });
  
      const { rows } = await pool.query(`
        INSERT INTO task_comments (task_id, user_id, comment)
        VALUES ($1, $2, $3) RETURNING *
      `, [id, req.user.id, comment]);"""
      
    if target in content:
        print("Found via string replace")
"""
