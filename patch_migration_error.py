import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(
    r'res\.status\(500\)\.json\(\{ success: false, error: \'Lỗi khi chạy Migration\' \}\);',
    r'res.status(500).json({ success: false, error: error.message });',
    text
)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("Patch applied for error.message in migration API.")
