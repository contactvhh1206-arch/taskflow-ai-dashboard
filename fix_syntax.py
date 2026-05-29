import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the extra closing brace
pattern = r"\}\s*\}\s*\}\s*\}\s*\}\s*// FALLBACK: If insert_facility_id is still null"
replacement = r"}\n                }\n            }\n        }\n\n      // FALLBACK: If insert_facility_id is still null"

content = re.sub(pattern, replacement, content)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Syntax fixed.")
