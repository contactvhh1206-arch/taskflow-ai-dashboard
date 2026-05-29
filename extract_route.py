import re
import sys

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r"app\.post\('/api/ai/chat',.*?\n\}\);\n", content, re.DOTALL)
if match:
    with open('chat_route.txt', 'w', encoding='utf-8') as f:
        f.write(match.group(0))
else:
    print("Not found")
