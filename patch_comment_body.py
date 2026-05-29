import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target = r"const \{ comment \} = req\.body;\n\s*if \(\!comment\) return res\.status\(400\)\.json\(\{ error: '.*?trống' \}\);"

replacement = r"""const comment = req.body.comment || req.body.content;
    if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });"""

content = re.sub(target, replacement, content, count=1)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched comment field extraction")
