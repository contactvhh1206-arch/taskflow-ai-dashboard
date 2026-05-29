import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    text = f.read()

# Use regex to remove the block
text = re.sub(
    r'// ==========================================\n// ONE-OFF MIGRATION API \(TẠM THỜI\)\n// ==========================================\napp\.get\(\'/api/dev/migrate-departments\', async \(req, res\) => \{.*?\n\}\);\n\n',
    '',
    text,
    flags=re.DOTALL
)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("Migration API removed from server.js")
