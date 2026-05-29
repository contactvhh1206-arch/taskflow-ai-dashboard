import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target_start_str = "    const newComment = rows[0];\n    const nameRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [realUserId]);\n    newComment.user_name = nameRes.rows.length > 0 ? nameRes.rows[0].full_name : 'Unknown';\n    res.json({ success: true, data: newComment });"

start_idx = content.find("    const newComment = rows[0];")
if start_idx != -1:
    end_idx = content.find("    res.json({ success: true, data: newComment });", start_idx)
    if end_idx != -1:
        end_idx += len("    res.json({ success: true, data: newComment });")
        
        replacement = """// Khởi tạo newComment an toàn tuyệt đối, chống lỗi undefined
    const newComment = (rows && rows.length > 0) ? rows[0] : { task_id: id, user_id: realUserId, comment: comment };
    
    // Lấy tên User an toàn
    try {
        const nameRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [realUserId]);
        newComment.user_name = (nameRes.rows && nameRes.rows.length > 0) ? nameRes.rows[0].full_name : 'Unknown';
    } catch (nameErr) {
        console.error("Lỗi lấy tên user:", nameErr);
        newComment.user_name = 'Unknown';
    }

    res.json({ success: true, data: newComment });"""
        
        new_content = content[:start_idx] + replacement + content[end_idx:]
        with open('server.js', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Successfully replaced block by index!")
    else:
        print("Could not find end index.")
else:
    print("Could not find start index.")
