const pool = require('../config/database');
const aiService = require('../services/aiService');

const chatStreamHandler = async (req, res) => {
    // Tương thích cả camelCase và snake_case từ frontend
    const message = req.body.message;
    let { sessionId, session_id } = req.body;
    sessionId = sessionId || session_id;
    const userContext = req.user;

    // 1. Rào chắn đầu vào (Validation)
    if (!message) {
        return res.status(400).json({
            success: false,
            message: "Bad Request: Thiếu message."
        });
    }

    // 1.5 Tự động tạo Session nếu Frontend gửi null (trường hợp click gợi ý mới)
    let isNewSession = false;
    if (!sessionId) {
        try {
            const currentTimestamp = Date.now();
            const { rows } = await pool.query(
                'INSERT INTO ai_chat_sessions (title, facility_id, user_id, timestamp) VALUES ($1, $2, $3, $4) RETURNING id', 
                ['Phiên AI mới', userContext.facility_id, userContext.id, currentTimestamp]
            );
            sessionId = rows[0].id;
            isNewSession = true;
        } catch (e) {
            console.error("Lỗi tạo session tự động:", e);
        }
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
    
    const logDepartmentCode = userContext.department_code || null;

    try {
        // [DB WRITE] 1. Hứng câu hỏi của User
        await pool.query(`
            INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
            VALUES ($1, $2, $3, 'user', $4)
        `, [sessionId, logFacilityId, logDepartmentCode, message]);

        // Bump timestamp của session
        await pool.query(
            'UPDATE ai_chat_sessions SET timestamp = $1 WHERE id = $2',
            [Date.now(), sessionId]
        );

        // Bơm SessionID mới về Frontend để React chốt URL
        if (isNewSession && isClientConnected) {
            res.write(`data: ${JSON.stringify({ sessionId: sessionId })}\n\n`);
        }

        // [DB READ] 2. Trích xuất Context - Sliding Window LIMIT 100 & RBAC Kỷ luật thép
        const { rows: historyRows } = await pool.query(`
            SELECT m.role, m.content, m.tool_calls
            FROM ai_chat_messages m
            INNER JOIN ai_chat_sessions s ON m.session_id = s.id
            WHERE m.session_id = $1 AND s.user_id = $2
            ORDER BY m.created_at DESC
            LIMIT 100
        `, [sessionId, userContext.id]);

        // Đảo ngược mảng để trả về đúng timeline cũ -> mới
        historyRows.reverse();

        // [LOGIC] 3. Lọc "Tin nhắn mồ côi" (Chống lỗi HTTP 400)
        while (historyRows.length > 0) {
            const firstMsg = historyRows[0];
            if (firstMsg.role === 'tool' || (firstMsg.role === 'assistant' && firstMsg.tool_calls)) {
                historyRows.shift();
            } else {
                break;
            }
        }

        // 4. Ráp mảng messages nạp cho LLM (Ép múi giờ VN)
        const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        const messages = [
            { role: "system", content: "Bạn là AI Advisor. Hôm nay là ngày " + todayVN + ". Hãy phân tích công việc và báo cáo số liệu chuẩn xác dựa vào khoảng thời gian được cung cấp." }
        ];

        for (const msg of historyRows) {
            const formattedMsg = { role: msg.role };
            if (msg.content && msg.content.trim() !== "") {
                formattedMsg.content = msg.content;
            }
            
            if (msg.role === 'assistant' && msg.tool_calls) {
                try {
                    const parsedToolCalls = typeof msg.tool_calls === 'string' 
                        ? JSON.parse(msg.tool_calls) 
                        : msg.tool_calls;
                    if (parsedToolCalls && parsedToolCalls.length > 0) {
                        formattedMsg.tool_calls = parsedToolCalls;
                    }
                } catch (e) {}
            } else if (msg.role === 'tool') {
                let toolCallId = `call_${msg.id}`;
                if (msg.tool_calls) {
                    try {
                        const meta = typeof msg.tool_calls === 'string' 
                            ? JSON.parse(msg.tool_calls) 
                            : msg.tool_calls;
                        if (meta.tool_call_id) toolCallId = meta.tool_call_id;
                    } catch (e) {}
                }
                formattedMsg.tool_call_id = toolCallId;
                formattedMsg.tool_call_id = toolCallId;
            }
            
            messages.push(formattedMsg);
        }

        // 5. Gửi Request lên LLM
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const llmPayload = {
            model: "google/gemini-3.1-pro-preview", 
            messages: messages,
            tools: aiService.AI_TOOLS,
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

        if (!response1.ok) {
            const errText = await response1.text();
            throw new Error(`API LLM (Lượt 1) lỗi ${response1.status}: ${errText}`);
        }
        const data1 = await response1.json();
        const aiMessage = data1.choices[0].message;

        if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
            // [DB WRITE] Lưu luồng Tool Call từ Assistant
            await pool.query(`
                INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, tool_calls)
                VALUES ($1, $2, $3, 'assistant', $4, $5)
            `, [sessionId, logFacilityId, logDepartmentCode, aiMessage.content || "", JSON.stringify(aiMessage.tool_calls)]);

            // [DỌN RÁC LƯỢT 1]: Chống ảo giác schema Gemini
            if (!aiMessage.content || aiMessage.content.trim() === "") {
                delete aiMessage.content;
            }
            messages.push(aiMessage); 

            for (const toolCall of aiMessage.tool_calls) {
                const funcName = toolCall.function.name;
                const funcArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};

                // Chạy Tool thực tế
                const toolResult = await aiService.processToolCall(funcName, funcArgs, userContext);
                
                // Ép kiểu an toàn chống [object Object]
                const safeToolResult = typeof toolResult === 'object' ? JSON.stringify(toolResult) : String(toolResult);
                
                // Gói tool metadata vào dạng JSON để lưu vào cột tool_calls
                const toolMeta = {
                    tool_call_id: toolCall.id,
                    name: funcName
                };

                // [DB WRITE] Lưu Luồng Tool Result
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, tool_calls)
                    VALUES ($1, $2, $3, 'tool', $4, $5)
                `, [sessionId, logFacilityId, logDepartmentCode, safeToolResult, JSON.stringify(toolMeta)]);

                // [DỌN RÁC LƯỢT 2]: Cấm key name trong role tool
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: safeToolResult
                });
            }

            const llmStreamPayload = {
                model: "google/gemini-3.1-pro-preview",
                messages: messages,
                stream: true,
                max_tokens: 4096
            };

            const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(llmStreamPayload)
            });

            if (!response2.ok) {
                const errText = await response2.text();
                throw new Error(`API LLM (Lượt Stream) lỗi ${response2.status}: ${errText}`);
            }
            
            const reader = response2.body.getReader();
            const decoder = new TextDecoder("utf-8");
            
            let fullAiReply = "";
            let buffer = ""; 
            
            while (true) {
                const { done, value } = await reader.read();
                if (done || !isClientConnected) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
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
                        } catch (parseErr) {}
                    }
                }
            }

            // [DB WRITE] Lưu luồng AI Text (Lưu bất chấp mạng Client đứt)
            if (fullAiReply && fullAiReply.length > 0) {
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                    VALUES ($1, $2, $3, 'assistant', $4)
                `, [sessionId, logFacilityId, logDepartmentCode, fullAiReply]);
            }
            
        } else {
            // [DB WRITE] Lưu Chat Thường
            const content = aiMessage.content || "";
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
            
            if (content && content.length > 0) {
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                    VALUES ($1, $2, $3, 'assistant', $4)
                `, [sessionId, logFacilityId, logDepartmentCode, content]);
            }
        }

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
        const { rows } = await pool.query(
            'SELECT * FROM ai_chat_sessions WHERE user_id = $1 ORDER BY timestamp DESC NULLS LAST', 
            [req.user.id]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
};

const createSessionHandler = async (req, res) => {
    try {
        const currentTimestamp = Date.now();
        const { rows } = await pool.query(
            'INSERT INTO ai_chat_sessions (title, facility_id, user_id, timestamp) VALUES ($1, $2, $3, $4) RETURNING *', 
            ['Phiên AI mới', req.user.facility_id, req.user.id, currentTimestamp]
        );
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const pingBatchHandler = async (req, res) => {
    try {
        const { taskIds } = req.body;
        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const data = taskIds.map(id => ({
            taskId: id,
            generated_message: `Cố vấn AI nhận thấy công việc này đang tới hạn. Bạn có cần hỗ trợ điều phối thêm nhân sự không? Đừng quá áp lực nhé!`
        }));

        res.json({ success: true, data });
    } catch (error) {
        console.error("Lỗi AI Ping Batch:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getMessagesHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { rows } = await pool.query(
            `SELECT m.id, m.role, m.content 
             FROM ai_chat_messages m
             JOIN ai_chat_sessions s ON m.session_id = s.id
             WHERE m.session_id = $1 AND s.user_id = $2 
             ORDER BY m.created_at ASC`, 
            [id, userId]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error("Lỗi GET messages:", error);
        res.json({ success: true, data: [] });
    }
};

module.exports = {
    chatStreamHandler,
    getSessionsHandler,
    createSessionHandler,
    pingBatchHandler,
    getMessagesHandler
};
