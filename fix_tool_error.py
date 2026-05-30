import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

pattern1 = re.compile(
    r'throw new Error\("Lá»—i: MÃ£ phÃ²ng ban/cÆ¡ sá»Ÿ khÃ´ng há»£p lá»‡ hoáº·c bá»‹ trá»‘ng\."\);'
)
replacement1 = 'return { error: "Lỗi: Mã phòng ban/cơ sở không hợp lệ hoặc bị trống." };'
content = pattern1.sub(replacement1, content)

pattern2 = re.compile(
    r'throw new Error\(`AI Tá»ª CHá» I: Báº¡n khÃ´ng cÃ³ quyá» n táº¡o task cho phÃ²ng ban \[\$\{normalizedDept\}\]\. Tháº©m quyá» n cá»§a báº¡n giá»›i háº¡n táº¡i: \[\$\{userDept\}\]\.`\);'
)
replacement2 = 'return { error: `AI TỪ CHỐI: Bạn không có quyền tạo task cho phòng ban [${normalizedDept}]. Thẩm quyền của bạn giới hạn tại: [${userDept}].` };'
content = pattern2.sub(replacement2, content)

pattern3 = re.compile(
    r'throw new Error\(`Lá»—i: AI truyá» n Ä‘á»‹nh dáº¡ng ngÃ y thÃ¡ng khÃ´ng há»£p lá»‡ \(\$\{deadline\}\)\. YÃªu cáº§u Ä‘á»‹nh dáº¡ng YYYY-MM-DD\.`\);'
)
replacement3 = 'return { error: `Lỗi: AI truyền định dạng ngày tháng không hợp lệ (${deadline}). Yêu cầu định dạng YYYY-MM-DD.` };'
content = pattern3.sub(replacement3, content)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced throw new Error with return { error: ... } successfully!")
