import re

filepath = 'server.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace console.log("Header nhận được:", req.headers);
content = content.replace('    console.log("Header nhận được:", req.headers);\n', '')

# Replace console.log("Payload tạo task:", req.body);
content = content.replace('      console.log("Payload tạo task:", req.body);\n', '')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("server.js cleaned up console logs.")
