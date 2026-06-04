const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');
code = code.replace('let final_pic_id = null;', 'let final_pic_id = null;\n      let foundPic = null;');
code = code.replace('const foundPic = picCheck.rows[0];', 'foundPic = picCheck.rows[0];');
fs.writeFileSync('backend/server.js', code, 'utf8');
console.log('Fixed!');
