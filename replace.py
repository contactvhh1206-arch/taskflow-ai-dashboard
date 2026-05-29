import sys

with open("temp_target.txt", "r", encoding="utf-8") as f:
    target = f.read()

replacement = target.replace("content: null,", "content: aiReplyContent || \"\",")

addition = """
                if (!response2.ok) {
                    const errorBody = await response2.text();
                    console.error("OpenRouter Fetch 2 Error:", errorBody);
                    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\\n\\n*H? th?ng: Xin l?i, AI không th? phân tích k?t qu? doanh thu lúc này do l?i k?t n?i.*" } }] })}\\n\\n`);
                    res.write(`data: [DONE]\\n\\n`);
                    return res.end();
                }"""

replacement = replacement + addition

with open("server.js", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(target, replacement)

with open("server.js", "w", encoding="utf-8") as f:
    f.write(content)

print("Replaced successfully")
