import codecs

filepath = 'backend/server.js'

with codecs.open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('let final_pic_id = null;\n      const input_pic_id', 'let final_pic_id = null;\n      let foundPic = null;\n      const input_pic_id')
content = content.replace('const foundPic = picCheck.rows[0];', 'foundPic = picCheck.rows[0];')

with codecs.open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed")
