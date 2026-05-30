import re

with open('server.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "throw new Error" in line and "normalizedDept !== userDept" in lines[i-1]:
        lines[i] = "            return { error: `AI TỪ CHỐI: Bạn không có quyền tạo task cho phòng ban [${normalizedDept}]. Thẩm quyền của bạn giới hạn tại: [${userDept}].` };\n"
    elif "throw new Error" in line and "isNaN(parsedDate.getTime())" in lines[i-1]:
        lines[i] = "            return { error: `Lỗi: AI truyền định dạng ngày tháng không hợp lệ (${deadline}). Yêu cầu định dạng YYYY-MM-DD.` };\n"

with open('server.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Replaced throw Error with return {error} using line matching successfully!")
