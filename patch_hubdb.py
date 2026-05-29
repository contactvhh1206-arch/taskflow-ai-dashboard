import re

with open('server.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_code = """            await pool.query(saveUserMsgSql, [session_id, userMessage]);
        }

        // 1. KÍCH HOẠT MÀNG LỌC TIỀM THỨC
        let learnedRule = await detectAndLearnRule(userMessage, req.user.role, req.user.id);
        let systemPromptAddition = "";
        
        // FIX LOGIC: Chỉ thêm prompt báo cáo nếu thực sự có luật mới được nạp
        if (learnedRule) {
            systemPromptAddition = `\\n[HỆ THỐNG]: Bạn vừa tự động nạp chỉ đạo mới này vào trí nhớ RAG: "${learnedRule}". Hãy trả lời người dùng một cách ngầu, điện ảnh và thông báo rằng bạn đã ghi nhớ luật này vào hệ thống lõi.`;
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        // Flush headers
        res.flushHeaders();

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: aiModel,
                messages: messages,
                stream: true,
                stream_options: { include_usage: true }
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error("OpenRouter Stream Error:", errBody);
            // FIX SSE: Dùng \\n\\n thay vì Enter xuống dòng
            res.write(`data: ${JSON.stringify({ error: "Lỗi kết nối AI API" })}\\n\\n`);
            return res.end();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let aiReplyContent = "";
        
        // Khai báo sẵn biến để hứng Token Usage ở bước sau
        let promptTokens = 0; 
        let completionTokens = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            // FIX SYNTAX ERROR: Chuyển dấu enter thành \\n
            const lines = chunk.split("\\n");
            
            for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                    try {
                        const parsed = JSON.parse(line.substring(6));
                        
                        // Xử lý content chunk
                        if (parsed.choices && parsed.choices.length > 0) {
                            const contentChunk = parsed.choices[0].delta?.content || "";
                            if (contentChunk) {
                                aiReplyContent += contentChunk;
                                // FIX SSE: Dùng \\n\\n chuẩn
                                res.write(`data: ${JSON.stringify({ content: contentChunk })}\\n\\n`);
                            }
                        }
                    } catch (e) {
                        // Bỏ qua lỗi parse JSON cho các chunk không hoàn chỉnh
                        console.error("Lỗi parse JSON stream chunk:", e);
                    }
                }
            }
        }
"""

start_idx = 1900
end_idx = 1970
lines[start_idx:end_idx] = [new_code]

with open('server.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("HubDB code applied.")
