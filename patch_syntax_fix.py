import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix ragContext
pattern1 = r'ragContext\s*=\s*".*?\[KIẾN THỨC NỀN TỪ DATABASE\]:.*?"\s*\+\s*memoryResults\.map\(r\s*=>\s*`- \$\{r\.content\}`\)\.join\(".*?"\);'
good1 = "ragContext = `\\n\\n[KIẾN THỨC NỀN TỪ DATABASE]:\\n` + memoryResults.map(r => `- ${r.content}`).join('\\n');"
text = re.sub(pattern1, good1, text, flags=re.DOTALL)

# Fix systemPromptAddition
pattern2 = r'systemPromptAddition\s*=\s*".*?\[HỆ THỐNG\]:.*?"\$\{learnedRule\}".*?";'
good2 = 'systemPromptAddition = `\\n\\n[HỆ THỐNG]: Bạn vừa tự động nạp chỉ đạo mới này vào trí nhớ RAG: "${learnedRule}". Hãy trả lời người dùng một cách ngầu, điện ảnh và thông báo rằng bạn đã ghi nhớ luật này vào hệ thống lõi.`;'
text = re.sub(pattern2, good2, text, flags=re.DOTALL)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Syntax error patched.")
