import re

clean_route = r"""app.post('/api/ai/chat', authenticateUser, async (req, res) => {
    try {
        const { message, session_id } = req.body;
        const userMessage = message || req.body.content;
        
        if (!userMessage) return res.status(400).json({ error: "Message is required" });

        // ==========================================
        // NHỊP 1: LƯU CÂU HỎI & CHỐNG MẤT DỮ LIỆU
        // ==========================================
        if (session_id) {
            const checkSession = await pool.query("SELECT id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2", [session_id, req.user.id]);
            if (checkSession.rowCount === 0) return res.status(403).json({ error: "Lỗi phiên làm việc." });
            
            const saveUserMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`;
            await pool.query(saveUserMsgSql, [session_id, userMessage]);
        }

        // ==========================================
        // NHỊP 2: RAG & MÀNG LỌC TIỀM THỨC
        // ==========================================
        let learnedRule = await detectAndLearnRule(userMessage, req.user.role, req.user.id);
        let systemPromptAddition = "";
        
        if (learnedRule) {
            systemPromptAddition = String.fromCharCode(10) + `[HỆ THỐNG]: Bạn vừa tự động nạp chỉ đạo mới này vào trí nhớ RAG: "${learnedRule}". Hãy trả lời người dùng một cách ngầu, điện ảnh và thông báo rằng bạn đã ghi nhớ luật này vào hệ thống lõi.`;
        }

        // Phục dựng lại mảng messages (RAG + Context Window)
        const ragContextRows = await searchKnowledgeBase(userMessage, req.user, 3);
        const ragContextText = ragContextRows.map(row => row.content).join(String.fromCharCode(10));
        const finalSystemPrompt = "Bạn là trợ lý ảo AI Advisor thông minh của hệ thống TaskFlow." + String.fromCharCode(10) + 
                                  (ragContextText ? "Dữ liệu tham khảo:" + String.fromCharCode(10) + ragContextText : "") + 
                                  systemPromptAddition;

        let chatHistory = [];
        if (session_id) {
            chatHistory = await getConversationContext(session_id, req.user.id);
        }

        const messages = [
            { role: "system", content: finalSystemPrompt },
            ...chatHistory,
            { role: "user", content: userMessage }
        ];

        // ==========================================
        // NHỊP 3: SSE STREAMING
        // ==========================================
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini", // Tuỳ chỉnh model theo config của bạn
                messages: messages,
                stream: true,
                stream_options: { include_usage: true }
            })
        });

        if (!response.ok) {
            console.error("OpenRouter Stream Error:", await response.text());
            res.write(`data: ${JSON.stringify({ error: "Lỗi kết nối AI API" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            return res.end();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let aiReplyContent = "";
        let promptTokens = 0; 
        let completionTokens = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split(String.fromCharCode(10));
            
            for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                    try {
                        const parsed = JSON.parse(line.substring(6));
                        
                        // Hứng Token Usage (OpenAI trả về ở chunk cuối cùng)
                        if (parsed.usage) {
                            promptTokens = parsed.usage.prompt_tokens || 0;
                            completionTokens = parsed.usage.completion_tokens || 0;
                        }

                        // Hứng Content Chunk
                        if (parsed.choices && parsed.choices.length > 0) {
                            const contentChunk = parsed.choices[0].delta?.content || "";
                            if (contentChunk) {
                                aiReplyContent += contentChunk;
                                res.write(`data: ${JSON.stringify({ content: contentChunk })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                            }
                        }
                    } catch (e) {
                        console.error("Lỗi parse JSON stream chunk:", e);
                    }
                }
            }
        }

        res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
        res.end();

        // ==========================================
        // NHỊP 4: LƯU DB & GHI LOG BẢO MẬT
        // ==========================================
        if (session_id && aiReplyContent) {
            const saveAiMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`;
            await pool.query(saveAiMsgSql, [session_id, aiReplyContent]);
        }

        // Ghi log chính xác 100% vào bảng ai_ping_logs chuẩn
        if (promptTokens > 0 || completionTokens > 0) {
            const totalTokens = promptTokens + completionTokens;
            await pool.query(`
                INSERT INTO ai_ping_logs (user_id, facility_id, prompt_tokens, completion_tokens, total_tokens)
                VALUES ($1, $2, $3, $4, $5)
            `, [req.user.id, req.user.facility_id || null, promptTokens, completionTokens, totalTokens]);
        }

    } catch (error) {
        console.error("AI Chat Stream error:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Lỗi hệ thống AI Chat." });
        } else {
            res.end();
        }
    }
});"""

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace the old broken route with the fully cleaned route
text = re.sub(r"app\.post\('/api/ai/chat'.*?res\.status\(500\)\.json\(\{ error: \"Lỗi hệ thống AI Chat\.\" \}\);\n\s+\} else \{\n\s+res\.end\(\);\n\s+\}\n\s+\}\n\}\);\n", clean_route + "\n", text, flags=re.DOTALL)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Syntax errors patched globally in the API route.")
