import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Remove the require line
old_require = "const multer = require('multer');"
text = text.replace(old_require, "")

# 2. Add the import to the top of the file
# Insert after `import bcrypt from 'bcryptjs';`
import_statement = "import bcrypt from 'bcryptjs';\nimport multer from 'multer';"
text = text.replace("import bcrypt from 'bcryptjs';", import_statement)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Fixed require to import successfully!")
