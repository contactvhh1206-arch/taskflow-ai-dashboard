import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

chat_code = """
// ==============================================================================
// AI ADVISOR CHAT API (WITH RAG MEMORY)
// ==============================================================================

async function detectAndLearnRule(message, role, userId) {
    if (role !== 'SUPER_ADMIN' && role !== 'VICE_PRESIDENT') {
        return null; // Chỉ Sếp mới được tạo luật
    }
    
    try {
        const systemPrompt = "Bạn là bộ lọc chỉ đạo. Hãy đọc câu của Sếp. Nếu đó là một chỉ đạo, quy định, hoặc nội quy mới về công việc, hãy trích xuất gọn gàng nội dung cốt lõi của chỉ đạo đó. Nếu đó chỉ là câu chat bình thường hoặc hỏi đáp, trả về chính xác chữ 'NULL'.";
        
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini", // GPT-4o-mini for fast & cheap rule detection
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ]
            })
        });
        
        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            let result = data.choices[0].message.content.trim();
            // Xóa ngoặc kép nếu có
            if (result.startsWith('"') && result.endsWith('"')) {
                result = result.slice(1, -1);
            }
            if (result !== 'NULL' && result !== 'null') {
                await saveToKnowledgeBase(result, 'BOSS_INSTRUCTION', { userId, role });
                return result;
            }
        }
    } catch (e) {
        console.error("detectAndLearnRule error:", e);
    }
    return null;
}

app.post('/api/ai/chat', authenticateUser, async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        const userMessage = message || req.body.content;
        
        if (!userMessage) return res.status(400).json({ error: "Message is required" });

        // 1. KÍCH HOẠT MÀNG LỌC TIỀM THỨC (Chỉ đạo mới)
        let learnedRule = await detectAndLearnRule(userMessage, req.user.role, req.user.id);
        let systemPromptAddition = "";
        
        if (learnedRule) {
            systemPromptAddition = `\\n\\n[HỆ THỐNG]: Bạn vừa tự động nạp chỉ đạo mới này vào trí nhớ RAG: "${learnedRule}". Hãy trả lời người dùng một cách ngầu, điện ảnh và thông báo rằng bạn đã ghi nhớ luật này vào hệ thống lõi.`;
        }

        // 2. LỤC LỌI TRÍ NHỚ (Truy xuất luật cũ)
        let ragContext = "";
        try {
            const memoryResults = await searchKnowledgeBase(userMessage, 3);
            if (memoryResults && memoryResults.length > 0) {
                ragContext = "\\n\\n[KIẾN THỨC NỀN TỪ DATABASE]:\\n" + memoryResults.map(r => `- ${r.content}`).join("\\n");
            }
        } catch (e) {
            console.error("Lỗi tìm kiếm RAG:", e);
        }

        // 3. XÂY DỰNG SYSTEM PROMPT HOÀN CHỈNH
        let finalSystemPrompt = "Bạn là trợ lý ảo AI Advisor thông minh của hệ thống TaskFlow." + ragContext + systemPromptAddition;

        const messages = [
            { role: "system", content: finalSystemPrompt },
            ...history,
            { role: "user", content: userMessage }
        ];

        // 4. GỌI OPENAI / OPENROUTER
        const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
        const aiConfig = configRows.length > 0 ? configRows[0].data : {};
        const aiModel = aiConfig.model || "google/gemini-2.5-flash";

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: aiModel,
                messages: messages
            })
        });

        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            return res.json({ success: true, reply: data.choices[0].message.content });
        } else {
            return res.status(500).json({ error: "AI response error", details: data });
        }
        
    } catch (error) {
        console.error("AI Chat error:", error);
        res.status(500).json({ error: "Lỗi hệ thống AI Chat." });
    }
});

// Start server"""

text = text.replace("// Start server", chat_code)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected AI Chat with RAG memory.")
