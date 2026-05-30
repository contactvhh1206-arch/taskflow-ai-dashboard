import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the specific remaining newline
content = content.replace('riêng từng cơ sở.* \n\n" } }] })}\\n\\n`);', 'riêng từng cơ sở.* \\n\\n" } }] })}\\n\\n`);')

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed the last newline!")
