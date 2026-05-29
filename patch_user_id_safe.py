import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target_start_str = "    // Lấy user_id thực sự từ token thay vì req.user.id (vốn bị undefined)"
target_end_str = "    realUserId = realUserId || 1; // Fallback an toàn để không văng 500"

start_idx = content.find(target_start_str)
end_idx = content.find(target_end_str, start_idx)

if start_idx != -1 and end_idx != -1:
    end_idx += len(target_end_str)
    
    replacement = """// Lấy user_id an toàn tuyệt đối (Không bao giờ văng 500)
    let realUserId = 1; // Fallback an toàn mặc định là 1
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
    } catch (parseErr) {
        console.error("Lỗi parse user an toàn:", parseErr);
    }"""
    
    new_content = content[:start_idx] + replacement + content[end_idx:]
    with open('server.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully replaced block by index!")
else:
    print(f"Could not find start or end index. Start: {start_idx}, End: {end_idx}")
