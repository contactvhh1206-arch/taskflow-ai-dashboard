import sys

try:
    with open('backend/server.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix 1: res.write with 'Hệ thống đang truy xuất...'
    old_str1 = r'res.write(`data: ${JSON.stringify({ text: "\\n\\n⏳ *Hệ thống đang truy xuất dữ liệu doanh thu chính xác từ kho lưu trữ, vui lòng đợi...*\\n\\n" })}\\n\\n`);'
    new_str1 = r'res.write(`data: ${JSON.stringify({ text: "\n\n⏳ *Hệ thống đang truy xuất dữ liệu doanh thu chính xác từ kho lưu trữ, vui lòng đợi...*\n\n" })}\n\n`);'
    content = content.replace(old_str1, new_str1)

    # Fix 2: split('\n')
    old_str2 = r"const lines = buffer.split('\\n');"
    new_str2 = r"const lines = buffer.split('\n');"
    content = content.replace(old_str2, new_str2)

    # Fix 3: res.write with chunkText
    old_str3 = r'res.write(`data: ${JSON.stringify({ text: chunkText })}\\n\\n`);'
    new_str3 = r'res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);'
    content = content.replace(old_str3, new_str3)

    with open('backend/server.js', 'w', encoding='utf-8') as f:
        f.write(content)

    print("SSE fixed successfully.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
