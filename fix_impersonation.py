import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Match from: // 1. LẤY USER_ID (even with mojibake)
# To: // [QUAN TRỌNG NHẤT] ... or exactly what is there
pattern = re.compile(r'// 1\. Láº¤Y USER_ID AN TOÃ€N VÃ€ CHáº¶N NGAY Náº¾U Rá»–NG.*?// 2\. THá»°C THI INSERT', re.DOTALL)

replacement = """// 1. LẤY USER_ID TỪ TOKEN, KHÔNG CHÂM CHƯỚC
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: '401 Unauthorized: Không thể xác định danh tính. Vui lòng đăng nhập lại!' });
    }
    const realUserId = req.user.id;

    // 2. THỰC THI INSERT"""

new_content, count = pattern.subn(replacement, content)

if count > 0:
    with open('server.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Success")
else:
    print("Failed")
