import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    server_text = f.read()

# 1. Add SECRET_KEY at the top
if "const SECRET_KEY =" not in server_text:
    server_text = server_text.replace(
        "import jwt from 'jsonwebtoken';",
        "import jwt from 'jsonwebtoken';\n\nconst SECRET_KEY = process.env.JWT_SECRET || 'HubDB_Global_Temp_Secret_2026_!!!';"
    )

# 2. Update authenticateUser verify
old_verify = "const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key_taskflow');"
new_verify = "const payload = jwt.verify(token, SECRET_KEY);"
if old_verify in server_text:
    server_text = server_text.replace(old_verify, new_verify)

# 3. Update catch block in authenticateUser
old_catch = """            } else {
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }"""
new_catch = """            } else {
                console.error('[Auth Middleware] Lỗi giải mã Token:', jwtErr.message);
                return res.status(401).json({ success: false, message: 'Invalid or Expired Token' });
            }"""
if old_catch in server_text:
    server_text = server_text.replace(old_catch, new_catch)

# 4. Update login sign
old_sign = "token: jwt.sign(tokenPayload, process.env.JWT_SECRET || 'fallback_secret_key_taskflow', { expiresIn: '7d' }),"
new_sign = "token: jwt.sign(tokenPayload, SECRET_KEY, { expiresIn: '7d' }),"
if old_sign in server_text:
    server_text = server_text.replace(old_sign, new_sign)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(server_text)

print("Patch applied.")
