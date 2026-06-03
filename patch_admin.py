import sys
import re

with open('backend/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the specific block in app.post('/api/config')
# Current: if (role !== 'SUPER_ADMIN') {
#          return res.status(403).json({ error: 'Không có quyền lưu cấu hình hệ thống. Yêu cầu quyền SUPER_ADMIN.' });
#      }
old_block = """    if (role !== 'SUPER_ADMIN') {
       return res.status(403).json({ error: 'Không có quyền lưu cấu hình hệ thống. Yêu cầu quyền SUPER_ADMIN.' });
    }"""
new_block = """    // SỬA ĐỔI THIẾT QUÂN LUẬT: Chấp nhận ADMIN hệ thống
    if (role !== 'ADMIN') {
        return res.status(403).json({ error: "403 Forbidden: Chỉ ADMIN mới có quyền ghi đè cấu hình lõi." });
    }"""

content = content.replace(old_block, new_block)

with open('backend/server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched successfully!")
