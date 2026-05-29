import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Find the start of app.post('/api/ai/chat'
start_idx = text.find("app.post('/api/ai/chat', authenticateUser, async (req, res) => {")

if start_idx != -1:
    # Find the end of this app.post block
    # We will search for "// Start server" to know where it ended roughly, since it's the last endpoint
    end_idx = text.find("// Start server", start_idx)
    
    if end_idx != -1:
        # Construct the new api
        new_api = """app.post('/api/ai/chat', authenticateUser, async (req, res) => {
    try {
        const { message, session_id } = req.body;
        const userMessage = message || req.body.content;
        
        if (!userMessage) return res.status(400).json({ error: "Message is required" });

        // ==========================================
        // NHẬP 1: LƯU CÂU HỎI & CHỐNG MẤT DỮ LIỆU
        // ==========================================
        if (session_id) {
            const checkSession = await pool.query("SELECT id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2", [session_id, req.user.id]);
            if (checkSession.rowCount === 0) return res.status(403).json({ error: "Lỗi phiên làm việc." });
            
            const saveUserMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`;
            await pool.query(saveUserMsgSql, [session_id, userMessage]);
        }

        // ==========================================
        // NHẬP 2: RAG & MẠNG LỌC TIỀM THỨC
        // ==========================================
        let learnedRule = await detectAndLearnRule(userMessage, req.user.role, req.user.id);
        let systemPromptAddition = "";
        
        if (learnedRule) {
            systemPromptAddition = String.fromCharCode(10) + `[HỆ THỐNG]: Bạn vừa tự động nạp chỉ đạo mới này vào trí nhớ RAG: "${learnedRule}". Hãy trả lời người dùng một cách ngắn gọn, diện ảnh và thông báo rằng bạn đã ghi nhớ luật này vào hệ thống lõi.`;
        }

        const ragContextRows = await searchKnowledgeBase(userMessage, req.user, 3);
        const rawRagText = ragContextRows.map(row => row.content).join("\\n\\n");
        const ragContextText = rawRagText.length > 4000 ? rawRagText.substring(0, 4000) + "\\n... [Đã cắt bớt do giới hạn bộ nhớ]" : rawRagText;
        
        const isLocalUser = req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'VICE_PRESIDENT' && req.user.role !== 'ADMIN';
        
        let finalSystemPrompt = "Bạn là trợ lý ảo AI Advisor thông minh của hệ thống TaskFlow." + String.fromCharCode(10) + 
                                  (ragContextText ? "Dữ liệu tham khảo:" + String.fromCharCode(10) + ragContextText : "") + 
                                  systemPromptAddition;

        if (isLocalUser) {
            finalSystemPrompt += String.fromCharCode(10) + "LƯU Ý BẢO MẬT: Bạn chỉ được trả lời các câu hỏi liên quan sát sườn đến nghiệp vụ phòng ban của người dùng. Nếu người dùng hỏi đùa, hỏi xàm, tán tỉnh hoặc hỏi các kiến thức ngoài công việc, bạn BẮT BUỘC phải trả về đúng từ khóa: [BLOCK_MISCONDUCT]";
        }

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
        // NHẬP 3: SSE STREAMING VỚI TOOL CALL
        // ==========================================
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const tools = [
            {
                type: "function",
                function: {
                    name: "create_system_task",
                    description: "Tạo hoặc giao một công việc mới cho phòng ban/cơ sở trên hệ thống.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Tiêu đề công việc" },
                            department_code: { type: "string", description: "Tên phòng ban (VD: Truyền thông, Kế toán, DB41)" },
                            deadline: { type: "string", description: "Hạn chót (ISO format hoặc text)" },
                            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }
                        },
                        required: ["title", "department_code"]
                    }
                }
            }
        ];

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini",
                messages: messages,
                stream: !isLocalUser,
                tools: tools,
                stream_options: !isLocalUser ? { include_usage: true } : undefined
            })
        });

        if (!response.ok) {
            console.error("OpenRouter Stream Error:", await response.text());
            res.write(`data: ${JSON.stringify({ error: "Lỗi kết nối AI API" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            return res.end();
        }

        let aiReplyContent = "";
        let promptTokens = 0; 
        let completionTokens = 0;
        let toolCallId = null;
        let toolCallName = null;
        let toolCallArguments = "";

        if (isLocalUser) {
            const data = await response.json();
            if (data.usage) {
                promptTokens = data.usage.prompt_tokens || 0;
                completionTokens = data.usage.completion_tokens || 0;
            }
            if (data.choices && data.choices.length > 0) {
                const msg = data.choices[0].message;
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    const tc = msg.tool_calls[0];
                    if (tc.id) toolCallId = tc.id;
                    if (tc.function && tc.function.name) toolCallName = tc.function.name;
                    if (tc.function && tc.function.arguments) toolCallArguments = tc.function.arguments;
                }
                if (msg.content) {
                    aiReplyContent = msg.content;
                }
            }
            
            // XỬ LÝ BLOCK MISCONDUCT NGAY LẬP TỨC
            if (aiReplyContent.includes('[BLOCK_MISCONDUCT]')) {
                await pool.query(`
                    INSERT INTO daily_logs (entry_type, user_id, action_details, created_at)
                    VALUES ($1, $2, $3, NOW())
                `, ['SECURITY_ALERT', req.user.id, `Nhân viên hỏi xàm hệ thống AI. Nội dung: "${userMessage}"`]);
                res.write(`data: ${JSON.stringify({ error: "HỆ THỐNG CẢNH BÁO: Câu hỏi của bạn vi phạm tiêu chuẩn nghiệp vụ nội bộ. Hành vi này đã được ghi nhận và gửi về tài khoản Admin để tiến hành truy vết kỷ luật!" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                return res.end();
            }
            
            // NẾU SẠCH SẼ, ĐẨY DỮ LIỆU XUỐNG SSE
            if (aiReplyContent) {
                res.write(`data: ${JSON.stringify({ content: aiReplyContent })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            }
        } else {
            // ADMIN STREAMING (Giữ nguyên)
            let reader = response.body.getReader();
            let decoder = new TextDecoder("utf-8");
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split(String.fromCharCode(10));
                
                for (const line of lines) {
                    if (line.startsWith("data: ") && line !== "data: [DONE]") {
                        try {
                            const parsed = JSON.parse(line.substring(6));
                            if (parsed.usage) {
                                promptTokens += parsed.usage.prompt_tokens || 0;
                                completionTokens += parsed.usage.completion_tokens || 0;
                            }
                            if (parsed.choices && parsed.choices.length > 0) {
                                const delta = parsed.choices[0].delta;
                                if (delta && delta.tool_calls) {
                                    const tc = delta.tool_calls[0];
                                    if (tc.id) toolCallId = tc.id;
                                    if (tc.function && tc.function.name) toolCallName = tc.function.name;
                                    if (tc.function && tc.function.arguments) toolCallArguments += tc.function.arguments;
                                }
                                if (delta && delta.content) {
                                    aiReplyContent += delta.content;
                                    res.write(`data: ${JSON.stringify({ content: delta.content })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                }
                            }
                        } catch (e) {
                            console.error("Lỗi parse JSON stream chunk:", e);
                        }
                    }
                }
            }
        }

        // ==========================================
        // NHẬP 3.5: THỰC THI TOOL VÀ FAIL-FAST
        // ==========================================
        if (toolCallName === "create_system_task" && toolCallArguments) {
            try {
                const args = JSON.parse(toolCallArguments);
                const result = await executeCreateTaskTool(args, req.user);
                const toolResultStr = JSON.stringify(result);
                
                messages.push({
                    role: "assistant",
                    content: null,
                    tool_calls: [{
                        id: toolCallId || "call_generated",
                        type: "function",
                        function: { name: toolCallName, arguments: toolCallArguments }
                    }]
                });
                messages.push({
                    role: "tool",
                    tool_call_id: toolCallId || "call_generated",
                    name: toolCallName,
                    content: toolResultStr
                });

                const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({
                        model: "openai/gpt-4o-mini",
                        messages: messages,
                        stream: !isLocalUser,
                        tools: tools,
                        stream_options: !isLocalUser ? { include_usage: true } : undefined
                    })
                });

                if (isLocalUser) {
                    const data2 = await response2.json();
                    if (data2.usage) {
                        promptTokens += data2.usage.prompt_tokens || 0;
                        completionTokens += data2.usage.completion_tokens || 0;
                    }
                    if (data2.choices && data2.choices.length > 0) {
                        const msg2 = data2.choices[0].message;
                        if (msg2.content) {
                            aiReplyContent += msg2.content;
                            
                            // XỬ LÝ BLOCK LẦN 2
                            if (aiReplyContent.includes('[BLOCK_MISCONDUCT]')) {
                                await pool.query(`
                                    INSERT INTO daily_logs (entry_type, user_id, action_details, created_at)
                                    VALUES ($1, $2, $3, NOW())
                                `, ['SECURITY_ALERT', req.user.id, `Nhân viên hỏi xàm hệ thống AI. Nội dung: "${userMessage}"`]);
                                res.write(`data: ${JSON.stringify({ error: "HỆ THỐNG CẢNH BÁO: Câu hỏi của bạn vi phạm tiêu chuẩn nghiệp vụ nội bộ. Hành vi này đã được ghi nhận và gửi về tài khoản Admin để tiến hành truy vết kỷ luật!" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                return res.end();
                            }

                            res.write(`data: ${JSON.stringify({ content: msg2.content })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                        }
                    }
                } else {
                    let reader2 = response2.body.getReader();
                    let decoder2 = new TextDecoder("utf-8");
                    while (true) {
                        const { done, value } = await reader2.read();
                        if (done) break;
                        const chunk = decoder2.decode(value, { stream: true });
                        const lines = chunk.split(String.fromCharCode(10));
                        for (const line of lines) {
                            if (line.startsWith("data: ") && line !== "data: [DONE]") {
                                try {
                                    const parsed = JSON.parse(line.substring(6));
                                    if (parsed.usage) {
                                        promptTokens += parsed.usage.prompt_tokens || 0;
                                        completionTokens += parsed.usage.completion_tokens || 0;
                                    }
                                    if (parsed.choices && parsed.choices.length > 0) {
                                        const contentChunk = parsed.choices[0].delta?.content || "";
                                        if (contentChunk) {
                                            aiReplyContent += contentChunk;
                                            res.write(`data: ${JSON.stringify({ content: contentChunk })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Tool Execution Error:", err.message);
                res.write(`data: ${JSON.stringify({ error: err.message })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                return res.end();
            }
        }

        // Kết thúc luồng stream an toàn
        if (!res.writableEnded) {
            res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            res.end();
        }

        // ==========================================
        // NHẬP 4: LƯU DB & GHI LOG BẢO MẬT
        // ==========================================
        if (session_id && aiReplyContent) {
            const saveAiMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`;
            await pool.query(saveAiMsgSql, [session_id, aiReplyContent]);
        }

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
});
\\n"""
        
        text = text[:start_idx] + new_api + text[end_idx:]
        
        with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as fw:
            fw.write(text)
        print("Data flow architecture patched successfully.")
    else:
        print("Could not find end of /api/ai/chat")
else:
    print("Could not find start of /api/ai/chat")
