import sys

try:
    with open('backend/server.js', 'r', encoding='utf-8') as f:
        content = f.read()

    old_str1_exact = r'res.write(`data: ${JSON.stringify({ text: "\\n\\n⏳ *Hệ thống đang truy xuất dữ liệu doanh thu chính xác từ kho lưu trữ, vui lòng đợi...*\\n\\n" })}\\n\\n`);'
    new_str1_exact = """res.write(`data: ${JSON.stringify({ text: "\\n\\n⏳ *Hệ thống đang truy xuất dữ liệu doanh thu chính xác từ kho lưu trữ, vui lòng đợi...*\\n\\n" })}

`);"""
    content = content.replace(old_str1_exact, new_str1_exact)

    old_str2_exact = r"const lines = buffer.split('\\n');"
    new_str2_exact = """const lines = buffer.split('\\n');"""
    # Wait, for lines.split, we WANT \n string in javascript! Not an actual newline!
    # Because JS code is: buffer.split('\n');
    # So the string in the file should be: buffer.split('\n'); (backslash n)
    # The old file has: buffer.split('\\n'); (backslash backslash n)
    new_str2_exact = "const lines = buffer.split('\\n');"
    content = content.replace(old_str2_exact, new_str2_exact)

    old_str3_exact = r'res.write(`data: ${JSON.stringify({ text: chunkText })}\\n\\n`);'
    new_str3_exact = """res.write(`data: ${JSON.stringify({ text: chunkText })}

`);"""
    content = content.replace(old_str3_exact, new_str3_exact)

    with open('backend/server.js', 'w', encoding='utf-8') as f:
        f.write(content)

    print("SSE fixed successfully.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
