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
            {
                role: "system",
                content: `Bạn là HUBDB AI - Cố vấn Chiến lược và Quản trị Doanh nghiệp Cấp cao của hệ thống. Hôm nay là ngày ${todayVN}.
Tác phong: Chuyên nghiệp, nhạy bén, sắc sảo, dứt khoát như một Giám đốc (CEO/CFO).

QUY TẮC TỐI THƯỢNG (BẮT BUỘC TUÂN THỦ):

TUYỆT ĐỐI KHÔNG liệt kê dữ liệu thô (ví dụ: cấm in ra một danh sách dài từng ngày, từng cơ sở).

TƯ DUY TỔNG HỢP & TÍNH TOÁN: Khi nhận được dữ liệu từ hệ thống, bạn PHẢI tự động tính Tổng (doanh thu/chi phí), tính Trung bình, và lọc ra các mức Cao nhất/Thấp nhất. Gom nhóm theo tháng hoặc cơ sở.

TRÌNH BÀY ĐẲNG CẤP: LUÔN trình bày số liệu bằng BẢNG (Markdown Table) để sếp dễ nhìn. In đậm các con số Tổng quan trọng. Dùng Bullet points để tóm tắt.

TƯ DUY CHIẾN LƯỢC: Kết thúc báo cáo, LUÔN đưa ra 1-2 nhận định sâu sắc về xu hướng (tăng/giảm, hiệu suất) và đề xuất hành động thực tiễn cho Ban Lãnh đạo.`
            }
        ];

        // [KIẾN TRÚC RAG THANH KHIẾT]: Phục hồi toàn bộ chuỗi nhân quả của Tool Call
        for (const msg of historyRows) {
            
            if (msg.role === 'tool') {
                const parsedMeta = typeof msg.tool_calls === 'string' ? JSON.parse(msg.tool_calls) : (msg.tool_calls || {});
                messages.push({ role: 'tool', tool_call_id: parsedMeta.tool_call_id, content: msg.content || "" });
            } 
            
            else if (msg.role === 'assistant') {
                if (msg.tool_calls) {
                    const safeParsedToolCallsArray = typeof msg.tool_calls === 'string' ? JSON.parse(msg.tool_calls) : msg.tool_calls;
                    messages.push({ 
                        role: 'assistant', 
                        content: (msg.content === "EMPTY" || !msg.content) ? "" : msg.content, 
                        tool_calls: safeParsedToolCallsArray 
                    });
                } else {
                    // [CHỐT CHẶN VIRUS]: Băm nát các tin nhắn rỗng, toàn khoảng trắng, hoặc chứa chính xác chữ "EMPTY"
                    if (!msg.content || msg.content.trim() === "" || msg.content === "EMPTY") {
                        continue;
                    }
                    messages.push({ role: 'assistant', content: msg.content });
                }
            } 
            
            // 3. Giữ nguyên câu hỏi của User
            else if (msg.role === 'user') {
                if (msg.content && msg.content.trim() !== "") {
                    messages.push({
                        role: 'user',
                        content: msg.content
                    });
                }
            }
        }

        // 5. Gửi Request lên LLM
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const llmPayload = {
            model: "google/gemini-3.1-pro-preview", 
            messages: messages,
            tools: aiService.AI_TOOLS,
            tool_choice: "auto"
        };

        const controller1 = new AbortController();
        const timeoutId1 = setTimeout(() => controller1.abort(), 120000);

        const response1 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(llmPayload),
            signal: controller1.signal
        });
        clearTimeout(timeoutId1);

        if (!response1.ok) {
            const errText = await response1.text();
            throw new Error(`API LLM (Lượt 1) lỗi ${response1.status}: ${errText}`);
        }
        const data1 = await response1.json();
        const aiMessage = data1.choices[0].message;

        if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
            
            // [DIỆT VIRUS OPENROUTER]: Triệt tiêu chữ "EMPTY" do OpenRouter tự ý nhét vào
            if (aiMessage.content && aiMessage.content.trim().includes("EMPTY")) {
                aiMessage.content = "";
            }

            // [DB WRITE] Lưu luồng Tool Call từ Assistant (Thay "EMPTY" bằng chuỗi rỗng "")
            await pool.query(`
                INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, tool_calls)
                VALUES ($1, $2, $3, 'assistant', $4, $5)
            `, [sessionId, logFacilityId, logDepartmentCode, aiMessage.content || "", JSON.stringify(aiMessage.tool_calls)]);

            // [SCHEMA FIX]: Phục hồi key content = "" thay vì delete, chống OpenRouter/Gemini báo lỗi schema
            if (!aiMessage.content || aiMessage.content.trim() === "") {
                aiMessage.content = ""; 
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

            // [KHIÊN TÂM LÝ]: Prompt Injection Lượt 2 để dằn mặt AI
            messages.push({
                role: "user",
                content: "HỆ THỐNG CẢNH BÁO: Dữ liệu đã được hệ thống cung cấp đầy đủ. TUYỆT ĐỐI CẤM SỬ DỤNG THÊM BẤT KỲ CÔNG CỤ (TOOL) NÀO NỮA. Yêu cầu phân tích tổng hợp thành văn bản trả lời cho người dùng NGAY LẬP TỨC."
            });

            const llmStreamPayload = {
                model: "google/gemini-3.1-pro-preview",
                messages: messages,
                tools: aiService.AI_TOOLS,
                stream: true,
                max_tokens: 4096
            };

            const controller2 = new AbortController();
            const timeoutId2 = setTimeout(() => controller2.abort(), 120000);

            const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(llmStreamPayload),
                signal: controller2.signal
            });

            if (!response2.ok) {
                clearTimeout(timeoutId2);
                const errText = await response2.text();
                throw new Error(`API LLM (Lượt Stream) lỗi ${response2.status}: ${errText}`);
            }
            
            const reader = response2.body.getReader();
            const decoder = new TextDecoder("utf-8");
            
            let fullAiReply = "";
            let buffer = ""; 
            
            try {
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
                                
                                // [PHÁ TỬ HUYỆT 1]: Chặn đứng và trích xuất nguyên vẹn bằng chứng lỗi gốc từ OpenRouter
                                if (data.error) {
                                    console.error('[OpenRouter API Error]:', data.error);
                                    res.write(`data: ${JSON.stringify({ error: data.error })}\n\n`);
                                    res.write('data: [DONE]\n\n');
                                    
                                    // [PHÁ TỬ HUYỆT 2]: Lệnh "return" sinh tử! 
                                    // Chém đứt toàn bộ function, chống bom sập Server (ERR_STREAM_WRITE_AFTER_END).
                                    return; 
                                }

                                const contentChunk = data?.choices?.[0]?.delta?.content || data?.content || "";
                                if (contentChunk) {
                                    fullAiReply += contentChunk;
                                    res.write(`data: ${JSON.stringify({ content: contentChunk })}\n\n`);
                                }
                            } catch (parseErr) {
                                console.error('[Stream Parse JSON Error]:', parseErr.message, 'Raw Line:', line);
                            }
                        }
                    }
                }
            } finally {
                clearTimeout(timeoutId2);
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
            
            if (content && content.length > 0) {
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                    VALUES ($1, $2, $3, 'assistant', $4)
                `, [sessionId, logFacilityId, logDepartmentCode, content]);
            }

            res.write(`data: ${JSON.stringify({ content })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }

        if (isClientConnected) {
            res.write('data: [DONE]\n\n');
            res.end();
        }

    } catch (error) {
        console.error('[AI Controller Error]:', error.name, error.message);
        if (isClientConnected) {
            const errorMsg = error.name === 'AbortError' 
                ? "Kết nối AI quá tải (Timeout 120s). Đã kích hoạt cơ chế bảo vệ UI. Xin thử lại." 
                : "Đã xảy ra sự cố giao tiếp với Hệ thống Thần kinh AI.";
                
            res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
            res.write('data: [DONE]\n\n');
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
             AND m.role IN ('user', 'assistant')
             AND m.content IS NOT NULL 
             AND TRIM(m.content) != '' 
             AND m.content != 'EMPTY'
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
