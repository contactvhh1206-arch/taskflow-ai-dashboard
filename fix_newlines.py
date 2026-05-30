import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the newlines inside res.write backticks
content = content.replace('content: "\n\n❌ *Hệ thống', 'content: "\\n\\n❌ *Hệ thống')
content = content.replace('] })}\n\n`);', '] })}\\n\\n`);')
content = content.replace('res.write(`data: [DONE]\n\n`);', 'res.write(`data: [DONE]\\n\\n`);')

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed SSE newlines!")
