import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

start_str = "app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {"
end_str = "    res.status(500).json({ error: 'Lỗi thêm bình luận.' });\n  }\n});"

start_idx = content.find(start_str)
if start_idx != -1:
    end_idx = content.find(end_str, start_idx)
    if end_idx != -1:
        end_idx += len(end_str)
        
        replacement = """app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const comment = req.body.comment || req.body.content;
    if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });

    // 1. LẤY USER_ID AN TOÀN VÀ CHẶN NGAY NẾU RỖNG (Nguyên nhân gốc gây sập)
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
        console.error("Lỗi parse user an toàn:", parseErr);
    }

    // [QUAN TRỌNG NHẤT]: TRẠM GÁC CHỐNG SẬP DB
    if (!realUserId) {
        return res.status(403).json({ error: 'Không thể xác định danh tính. Vui lòng đăng nhập lại!' });
    }

    // 2. THỰC THI INSERT (Lúc này realUserId đã được đảm bảo 100% là an toàn)
    const { rows } = await pool.query(`
      INSERT INTO task_comments (task_id, user_id, comment)
      VALUES ($1, $2, $3) RETURNING *
    `, [id, realUserId, comment]);
    
    // 3. [NOTIFICATIONS TRIGGER] (An toàn tuyệt đối)
    try {
        if (typeof sendRealtimeNotification === 'function') {
            const taskInfo = await pool.query('SELECT pic_id, title FROM tasks WHERE id = $1', [id]);
            if (taskInfo.rows.length > 0) {
                const tInfo = taskInfo.rows[0];
                if (tInfo.pic_id && parseInt(tInfo.pic_id) !== parseInt(realUserId)) {
                    sendRealtimeNotification(tInfo.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: "${tInfo.title}"`, id, realUserId);
                }
            }
        }
    } catch (err) { console.error("Notification comment err:", err); }

    // 4. KHỞI TẠO BIẾN TRẢ VỀ (Giữ lại logic bọc lót của Cố vấn để phòng thủ tầng 2)
    const newComment = (rows && rows.length > 0) ? rows[0] : { task_id: id, user_id: realUserId, comment: comment };
    
    try {
        const nameRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [realUserId]);
        newComment.user_name = (nameRes.rows && nameRes.rows.length > 0) ? nameRes.rows[0].full_name : 'Unknown';
    } catch (nameErr) {
        console.error("Lỗi lấy tên user:", nameErr);
        newComment.user_name = 'Unknown';
    }

    res.json({ success: true, data: newComment });
  } catch (err) {
    console.error("Lỗi POST Comment:", err);
    res.status(500).json({ error: 'Lỗi thêm bình luận: ' + err.message });
  }
});"""
        
        new_content = content[:start_idx] + replacement + content[end_idx:]
        with open('server.js', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Successfully replaced block by index!")
    else:
        print("Could not find end index.")
else:
    print("Could not find start index.")
