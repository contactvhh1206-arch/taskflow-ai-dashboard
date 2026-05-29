import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update initDB
tables_sql = """
    // Bảng quản lý phiên chat của AI Advisor
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_chat_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id INT REFERENCES users(id) ON DELETE CASCADE,
            facility_id INT REFERENCES facilities(id) ON DELETE CASCADE,
            department_code VARCHAR(50) NOT NULL,
            title VARCHAR(255) DEFAULT 'Cuộc hội thoại mới',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Bảng lưu chi tiết các câu chat
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_chat_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id UUID REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS ai_chat_messages_session_idx 
        ON ai_chat_messages(session_id, created_at ASC)
    `);
"""
if "ai_chat_sessions" not in text:
    text = text.replace("await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);", "await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);\n" + tables_sql)

# 2. Add getConversationContext and replace POST /api/ai/chat
chat_api = """
/**
 * Lấy lịch sử chat ngắn hạn, có bọc Auth Check chống ID Harvesting
 */
async function getConversationContext(sessionId, userId) {
    if (!sessionId) return [];

    try {
        const authCheckSql = `
            SELECT id FROM ai_chat_sessions 
            WHERE id = $1 AND user_id = $2
        `;
        const { rows: sessionRows } = await pool.query(authCheckSql, [sessionId, userId]);
        
        if (sessionRows.length === 0) {
            console.warn(`[SECURITY ALERT] User ${userId} cố gắng truy cập trái phép Session ${sessionId}`);
            throw new Error("403 Forbidden: Bạn không có quyền truy cập vào phiên chat này!");
        }

        const historySql = `
            SELECT role, content 
            FROM ai_chat_messages 
            WHERE session_id = $1 
            ORDER BY created_at DESC 
            LIMIT 6
        `;
        const { rows: historyRows } = await pool.query(historySql, [sessionId]);
        
        return historyRows.reverse().map(msg => ({
            role: msg.role,
            content: msg.content
        }));

    } catch (error) {
        console.error("Lỗi getConversationContext:", error);
        throw error;
    }
}

app.post('/api/ai/chat', authenticateUser, async (req, res) => {
    try {
        const { message, session_id } = req.body;
        const userMessage = message || req.body.content;
        
        if (!userMessage) return res.status(400).json({ error: "Message is required" });

        // Nhịp 1: Lưu ngay câu hỏi của User TRƯỚC KHI gọi LLM API (Chống mất mát dữ liệu)
        if (session_id) {
            // Xác thực lại session_id trước khi insert
            const checkSession = await pool.query("SELECT id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2", [session_id, req.user.id]);
            if (checkSession.rowCount === 0) return res.status(403).json({ error: "Lỗi phiên làm việc." });
            
            const saveUserMsgSql = `
                INSERT INTO ai_chat_messages (session_id, role, content) 
                VALUES ($1, 'user', $2)
            `;
            await pool.query(saveUserMsgSql, [session_id, userMessage]);
        }

        // 1. KÍCH HOẠT MÀNG LỌC TIỀM THỨC
        let learnedRule = await detectAndLearnRule(userMessage, req.user.role, req.user.id);
        let systemPromptAddition = "";
        
        if (learnedRule) {
            systemPromptAddition = `\\n\\n[HỆ THỐNG]: Bạn vừa tự động nạp chỉ đạo mới này vào trí nhớ RAG: "${learnedRule}". Hãy trả lời người dùng một cách ngầu, điện ảnh và thông báo rằng bạn đã ghi nhớ luật này vào hệ thống lõi.`;
        }

        // 2. LỤC LỌI TRÍ NHỚ RAG TỪ DATABASE
        let ragContext = "";
        try {
            const memoryResults = await searchKnowledgeBase(userMessage, req.user, 3);
            if (memoryResults && memoryResults.length > 0) {
                ragContext = "\\n\\n[KIẾN THỨC NỀN TỪ DATABASE]:\\n" + memoryResults.map(r => `- ${r.content}`).join("\\n");
            }
        } catch (e) {
            console.error("Lỗi tìm kiếm RAG:", e);
        }

        let finalSystemPrompt = "Bạn là trợ lý ảo AI Advisor thông minh của hệ thống TaskFlow." + ragContext + systemPromptAddition;

        // 3. BỘ NHỚ NGẮN HẠN
        let chatHistory = [];
        if (session_id) {
            chatHistory = await getConversationContext(session_id, req.user.id);
            // Loại bỏ câu hỏi hiện tại khỏi history vì đã insert ở nhịp 1
            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user' && chatHistory[chatHistory.length - 1].content === userMessage) {
                chatHistory.pop();
            }
        }

        const messages = [
            { role: "system", content: finalSystemPrompt },
            ...chatHistory,
            { role: "user", content: userMessage }
        ];

        // 4. GỌI OPENAI VỚI STREAMING (SSE)
        const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
        const aiConfig = configRows.length > 0 ? configRows[0].data : {};
        const aiModel = aiConfig.model || "google/gemini-2.5-flash";

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
            res.write(`data: ${JSON.stringify({ error: "Lỗi kết nối AI API" })}\\n\\n`);
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
                                res.write(`data: ${JSON.stringify({ content: contentChunk })}\\n\\n`);
                            }
                        }
                        
                        // Lấy token usage nếu có
                        if (parsed.usage) {
                            promptTokens = parsed.usage.prompt_tokens || 0;
                            completionTokens = parsed.usage.completion_tokens || 0;
                        }
                    } catch (err) {
                        console.error("Error parsing stream line:", line, err);
                    }
                }
            }
        }

        // Kết thúc luồng stream
        res.write("data: [DONE]\\n\\n");
        res.end();

        // Nhịp 2: Lưu câu trả lời của AI
        if (session_id && aiReplyContent) {
            const saveAiMsgSql = `
                INSERT INTO ai_chat_messages (session_id, role, content) 
                VALUES ($1, 'assistant', $2)
            `;
            await pool.query(saveAiMsgSql, [session_id, aiReplyContent]);
        }

        // Nhịp 3: Ghi nhận Token Usage
        if (promptTokens > 0 || completionTokens > 0) {
            // Log for statistics
            const totalTokens = promptTokens + completionTokens;
            await pool.query(`
                INSERT INTO ai_token_usage_logs (user_id, feature, prompt_tokens, completion_tokens, total_tokens)
                VALUES ($1, 'CHAT_ADVISOR', $2, $3, $4)
            `, [req.user.id, promptTokens, completionTokens, totalTokens]);
        } else {
            // Fallback token estimation
            const estPrompt = Math.ceil(JSON.stringify(messages).length / 4);
            const estComp = Math.ceil(aiReplyContent.length / 4);
            await pool.query(`
                INSERT INTO ai_token_usage_logs (user_id, feature, prompt_tokens, completion_tokens, total_tokens)
                VALUES ($1, 'CHAT_ADVISOR_EST', $2, $3, $4)
            `, [req.user.id, estPrompt, estComp, estPrompt + estComp]);
        }

    } catch (error) {
        console.error("AI Chat Stream error:", error);
        // If stream hasn't started sending data, return 500
        if (!res.headersSent) {
            res.status(500).json({ error: "Lỗi hệ thống AI Chat." });
        } else {
            res.end();
        }
    }
});
"""

# Replace old POST /api/ai/chat with new
text = re.sub(r'app\.post\(\'/api/ai/chat\', authenticateUser, async \(req, res\) => \{.*?\n\}\);\n', chat_api, text, flags=re.DOTALL)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

# Also update schema.sql
with open('agent/rules/stitch_smart_ai_task_management_system/server/schema.sql', 'r', encoding='utf-8') as f:
    schema = f.read()

if "ai_chat_sessions" not in schema:
    schema += "\n\n" + tables_sql.replace("await pool.query(`", "").replace("`);", ";")
    with open('agent/rules/stitch_smart_ai_task_management_system/server/schema.sql', 'w', encoding='utf-8') as f:
        f.write(schema)

print("Streaming and Context logic applied successfully.")
