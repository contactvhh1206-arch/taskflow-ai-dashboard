import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(
    "app.get('/api/ai/sessions', authenticateUser, checkAdmin, async (req, res) => {",
    "app.get('/api/ai/sessions', authenticateUser, async (req, res) => {"
)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Removed checkAdmin middleware from /api/ai/sessions")
