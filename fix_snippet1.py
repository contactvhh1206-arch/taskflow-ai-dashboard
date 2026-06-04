import re

with open('backend/server.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Snippet 1: Fix ALL_ACCESS_ROLES (Line ~1965)
content = content.replace(
    "const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'];",
    "const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'];"
)

with open('backend/server.js', 'w', encoding='utf-8') as f:
    f.write(content)
