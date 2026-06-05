const pool = require('../config/database');
const aiService = require('../services/aiService');

const chatStreamHandler = async (req, res) => {
    const { message, sessionId } = req.body;
    const userContext = req.user;

    // 1. Rào chắn đầu vào (Validation)
    if (!message || !sessionId) {
        return res.status(400).json({
            success: false,
            message: "Bad Request: Thiếu message hoặc sessionId."
        });
    }

    // 2. Khởi tạo Headers chuẩn SSE (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 3. Cờ kiểm soát Memory Leak (Ngắt luồng khi Client F5 hoặc Đóng tab)
    let isClientConnected = true;
    req.on('close', () => {
        isClientConnected = false;
        res.end();
    });

    // Ép kiểu INT4 an toàn cho facility_id để ghi Log DB
    let logFacilityId = null;
    if (userContext.facility_id !== null && userContext.facility_id !== undefined && userContext.facility_id !== 'ALL') {
        const parsed = Number(userContext.facility_id);
        if (!isNaN(parsed)) logFacilityId = parsed;
    }
    
    // Trích xuất bộ phận (Không dùng user_id theo chuẩn Schema mới)
    const logDepartmentCode = userContext.department_code || null;

    try {
        // 4. Đổ Log câu hỏi của User vào Database (Đã loại bỏ user_id hoàn toàn)
        await pool.query(`
            INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
            VALUES ($1, $2, $3, 'user', $4)
        `, [sessionId, logFacilityId, logDepartmentCode, message]);

        const messages = [
            { role: "system", content: "Bạn là AI Advisor. Hãy phân tích công việc và báo cáo số liệu chuẩn xác." },
            { role: "user", content: message }
        ];

        // 5. LƯỢT 1: Gửi Request lên LLM kèm theo Mồi nhử Tool
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const llmPayload = {
            model: "openai/gpt-4o", 
            messages: messages,
            tools: aiService.KANBAN_TOOLS,
            tool_choice: "auto"
        };

        const response1 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(llmPayload)
        });

        if (!response1.ok) throw new Error('API LLM (Lượt 1) từ chối truy cập.');
        const data1 = await response1.json();
        const aiMessage = data1.choices[0].message;

        // 6. THE SANDBOX: Xử lý quyết định gọi Tool của AI
        if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
            messages.push(aiMessage); 

            for (const toolCall of aiMessage.tool_calls) {
                const funcName = toolCall.function.name;
                const funcArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};

                // Sandbox Tiêm ngầm Context
                const toolResult = await aiService.processToolCall(funcName, funcArgs, userContext);
                
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: funcName,
                    content: toolResult
                });
            }

            // LƯỢT 2: Gửi lại Data RAG cho LLM tổng hợp thành Stream
            const llmStreamPayload = {
                model: "openai/gpt-4o",
                messages: messages,
                stream: true
            };

            const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(llmStreamPayload)
            });

            if (!response2.ok) throw new Error('API LLM (Lượt Stream) từ chối truy cập.');
            
            // Xử lý Bóc tách Buffer chống đứt gãy luồng
            const reader = response2.body.getReader();
            const decoder = new TextDecoder("utf-8");
            
            let fullAiReply = "";
            let buffer = ""; // Khởi tạo bộ đệm ngoài vòng lặp
            
            while (true) {
                const { done, value } = await reader.read();
                if (done || !isClientConnected) break;
                
                // Cộng dồn chunk vào buffer
                buffer += decoder.decode(value, { stream: true });
                
                // Tách dòng
                const lines = buffer.split('\n');
                
                // Giữ lại phần tử cuối cùng (có thể là JSON cắt dở) vào buffer cho vòng sau
                buffer = lines.pop();
                
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(6));
                            const contentChunk = data.choices[0]?.delta?.content || "";
                            if (contentChunk) {
                                fullAiReply += contentChunk;
                                res.write(`data: ${JSON.stringify({ content: contentChunk })}\n\n`);
                            }
                        } catch (parseErr) {
                            // Bỏ qua JSON rác
                        }
                    }
                }
            }

            // Đổ Log câu trả lời cuối cùng của AI vào Database (Không có user_id)
            if (fullAiReply && isClientConnected) {
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                    VALUES ($1, $2, $3, 'assistant', $4)
                `, [sessionId, logFacilityId, logDepartmentCode, fullAiReply]);
            }
            
        } else {
            // Chat thường (Không gọi Tool)
            const content = aiMessage.content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
            
            await pool.query(`
                INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                VALUES ($1, $2, $3, 'assistant', $4)
            `, [sessionId, logFacilityId, logDepartmentCode, content]);
        }

        // Đóng sập cầu dao Stream an toàn
        if (isClientConnected) {
            res.write('data: [DONE]\n\n');
            res.end();
        }

    } catch (error) {
        console.error('[AI Controller Error]:', error.message);
        if (isClientConnected) {
            res.write(`data: ${JSON.stringify({ error: 'Đã xảy ra sự cố giao tiếp với Hệ thống Thần kinh AI.' })}\n\n`);
            res.end();
        }
    }
};

const getSessionsHandler = async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM ai_chat_sessions WHERE facility = $1 ORDER BY updated_at DESC', [req.user.facility_id === 'ALL' ? 'ALL' : req.user.facility_id]);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
};

const createSessionHandler = async (req, res) => {
    try {
        const { rows } = await pool.query('INSERT INTO ai_chat_sessions (title, facility) VALUES ($1, $2) RETURNING *', ['Phiên AI mới', req.user.facility_id]);
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    chatStreamHandler,
    getSessionsHandler,
    createSessionHandler
};
