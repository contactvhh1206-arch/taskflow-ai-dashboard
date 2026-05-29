import re

filepath = 'server.js'
with open(filepath, 'r', encoding='utf-8') as f:
    text = f.read()

old_block = """    // 4. KH?I T?O BI?N TR? V? (Gi? l?i logic b?c lt c?a C? v?n d? phng th? t?ng 2)
    const newComment = (rows && rows.length > 0) ? rows[0] : { task_id: id, user_id: realUserId, content: comment };
    
    try {
        const nameRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [realUserId]);
        newComment.user_name = (nameRes.rows && nameRes.rows.length > 0) ? nameRes.rows[0].full_name : 'Unknown';
    } catch (nameErr) {
        console.error("L?i l?y tn user:", nameErr);
        newComment.user_name = 'Unknown';
    }

    res.json({ success: true, data: newComment });"""

# In case characters are messed up due to encoding in output, we use regex to match the block
pattern = re.compile(r'// 4\. KH[^\n]+.*?res\.json\(\{ success: true, data: newComment \}\);', re.DOTALL)

new_block = """    // 4. KHỞI TẠO BIẾN TRẢ VỀ TỪ CƠ SỞ DỮ LIỆU
    const newCommentId = (rows && rows.length > 0) ? rows[0].id : null;
    
    if (newCommentId) {
        const getCommentSql = `
           SELECT c.*, u.full_name as user_name, r.name as user_role 
           FROM task_comments c 
           LEFT JOIN users u ON c.user_id = u.id 
           LEFT JOIN roles r ON u.role_id = r.id 
           WHERE c.id = $1
        `;
        const fullComment = await pool.query(getCommentSql, [newCommentId]);
        return res.json({ success: true, data: fullComment.rows[0] });
    } else {
        return res.status(500).json({ success: false, error: 'Không thể tạo bình luận' });
    }"""

if pattern.search(text):
    text = pattern.sub(new_block, text)
else:
    print("WARNING: Could not find block with regex")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(text)

print("server.js patched for comment user mapping.")
