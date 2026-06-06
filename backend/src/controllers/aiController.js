const pool = require('../config/database');
const aiService = require('../services/aiService');
const crypto = require('crypto'); // KHẮC PHỤC BUG 1: Import độc lập

// UTILITY HELPER: Tiền xử lý Sanitization 
const parseSafeFacilityId = (facilityId) => {
    if (facilityId !== undefined && facilityId !== null && facilityId !== 'ALL' && facilityId !== '') {
        const parsed = Number(facilityId);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return null;
};

// BẢO VỆ BUG 3: Khiên Parse JSON chống sập luồng
const safeJsonParse = (str, fallbackValue = null) => {
    if (!str) return fallbackValue;
    if (typeof str !== 'string') return str;
    try {
        return JSON.parse(str);
    } catch (e) {
        console.error("[JSON PARSE ERROR] Dữ liệu Database bị hỏng cấu trúc:", str);
        return fallbackValue;
    }
};

const chatStreamHandler = async (req, res) => {
    // Tương thích cả camelCase và snake_case từ frontend
    const message = req.body.message;
    let { sessionId, session_id } = req.body;
    sessionId = sessionId || session_id;
    const userContext = req.user;

    // [BỔ SUNG GLOBAL ABORT CONTROLLER]
    const reqAbortController = new AbortController();

    // 1. Rào chắn đầu vào (Validation)
    if (!message) {
        return res.status(400).json({
            success: false,
            message: "Bad Request: Thiếu message."
        });
    }

    // 1. Áp dụng Helper làm sạch Facility ID
    const safeFacilityId = parseSafeFacilityId(userContext.facility_id);

    const logDepartmentCode = userContext.department_code || null;
    const logFacilityId = safeFacilityId;

    let isNewSession = false;
    
    // 1. KHẮC PHỤC BUG 1: TỰ BĂM UUID KHI TẠO SESSION 
    if (!sessionId) {
        try {
            sessionId = crypto.randomUUID(); // Sinh ID tại Backend
            const currentTimestamp = Date.now();
            await pool.query(
                'INSERT INTO ai_chat_sessions (id, title, facility_id, user_id, timestamp) VALUES ($1, $2, $3, $4, $5)', 
                [sessionId, 'Phiên AI mới', safeFacilityId, userContext.id, currentTimestamp]
            );
            isNewSession = true;
        } catch (e) {
            console.error("[CRITICAL] Lỗi khởi tạo Session tự động (SSE):", e.message);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
            
            res.write(`data: ${JSON.stringify({ error: "[LỖI HỆ THỐNG]: Không thể khởi tạo Phiên Chat mới do sự cố phân quyền hoặc CSDL." })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }
    }

    // 2. Khởi tạo Headers chuẩn SSE (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 2. KHẮC PHỤC BUG 2: CỜ TRẠNG THÁI VÀ HELPER LƯU DB BẤT TỬ
    let isClientConnected = true;
    let isAiReplySaved = false;
    let fullAiReply = "";

    const saveAiReplyToDb = async () => {
        // Khóa cờ ngay lập tức chống Race Condition nếu gọi đúp từ finally & sự kiện close
        if (!isAiReplySaved && fullAiReply.trim() !== "") {
            isAiReplySaved = true; 
            try {
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                    VALUES ($1, $2, $3, 'assistant', $4)
                `, [sessionId, logFacilityId, logDepartmentCode, fullAiReply]);
            } catch (err) {
                console.error("[CRITICAL] Lỗi lưu Database khi hoàn tất/rớt mạng Stream:", err.message);
                isAiReplySaved = false; // Phục hồi cờ
            }
        }
    };

    req.on('close', () => {
        isClientConnected = false;
        reqAbortController.abort(); // CHÉM ĐỨT NGAY LẬP TỨC MỌI FETCH REQUEST ĐANG CHẠY NGẦM
        saveAiReplyToDb(); // Kích hoạt lưu ngay phần chữ bị gãy khi mạng đứt
        res.end();
    });

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

        // [DB READ] 2. Trích xuất Context - Sliding Window LIMIT 20 & RBAC Kỷ luật thép
        const { rows: historyRows } = await pool.query(`
            SELECT m.role, m.content, m.tool_calls
            FROM ai_chat_messages m
            INNER JOIN ai_chat_sessions s ON m.session_id = s.id
            WHERE m.session_id = $1 AND s.user_id = $2
            ORDER BY m.created_at DESC
            LIMIT 20
        `, [sessionId, userContext.id]);

        // Đảo ngược mảng để trả về đúng timeline cũ -> mới
        historyRows.reverse();

        // 3. KHẮC PHỤC BUG 3: RAG FILTER V2 (DUYỆT 2 CHU KỲ - ID MAPPING)
        const requestedToolIds = new Set();
        const completedToolIds = new Set();

        // Chu kỳ 1: Gom ID Toàn cục
        for (const msg of historyRows) {
            if (msg.role === 'assistant' && msg.tool_calls) {
                const parsedToolCalls = safeJsonParse(msg.tool_calls, []);
                parsedToolCalls.forEach(tc => requestedToolIds.add(tc.id));
            } else if (msg.role === 'tool') {
                const parsedMeta = safeJsonParse(msg.tool_calls, {});
                if (parsedMeta.tool_call_id) completedToolIds.add(parsedMeta.tool_call_id);
            }
        }

        // Chu kỳ 2: Bộ lọc Song Ánh
        const validHistory = [];
        for (const msg of historyRows) {
            if (msg.role === 'assistant') {
                if (msg.tool_calls) {
                    const parsedToolCalls = safeJsonParse(msg.tool_calls, []);
                    // Healing Mảng: Ép khớp với lượng Tool thực sự trả về
                    const safeToolCalls = parsedToolCalls.filter(tc => completedToolIds.has(tc.id));
                    
                    const hasValidContent = (msg.content && msg.content.trim() !== "EMPTY" && msg.content.trim() !== "");

                    if (safeToolCalls.length > 0) {
                        msg.tool_calls = safeToolCalls; 
                        validHistory.push(msg);
                    } else if (hasValidContent) {
                        delete msg.tool_calls;
                        validHistory.push(msg);
                    }
                } else if (msg.content && msg.content.trim() !== "EMPTY" && msg.content.trim() !== "") {
                    validHistory.push(msg);
                }
            } else if (msg.role === 'tool') {
                const parsedMeta = safeJsonParse(msg.tool_calls, {});
                if (parsedMeta.tool_call_id && requestedToolIds.has(parsedMeta.tool_call_id)) {
                    validHistory.push(msg);
                }
            } else if (msg.role === 'user') {
                if (msg.content && msg.content.trim() !== "") validHistory.push(msg);
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
        for (const msg of validHistory) {
            if (msg.role === 'tool') {
                const parsedMeta = safeJsonParse(msg.tool_calls, {});
                messages.push({ role: 'tool', tool_call_id: parsedMeta.tool_call_id, name: parsedMeta.name || "unknown_tool", content: msg.content || "" });
            } else if (msg.role === 'assistant') {
                const astMsg = { role: 'assistant' };
                if (msg.content && msg.content.trim() !== "" && msg.content.trim() !== "EMPTY") {
                    astMsg.content = msg.content;
                } else {
                    astMsg.content = " "; // KHẮC PHỤC BUG: OpenRouter/Gemini yêu cầu content không được rỗng
                }
                if (msg.tool_calls) {
                    astMsg.tool_calls = msg.tool_calls;
                }
                messages.push(astMsg);
            } else if (msg.role === 'user') {
                messages.push({ role: 'user', content: msg.content });
            }
        }

        // 5. Gửi Request lên LLM
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const aiModel = req.body.model || process.env.DEFAULT_AI_MODEL || "google/gemini-3.1-pro-preview";
        const llmPayload = {
            model: aiModel, 
            messages: messages,
            tools: aiService.AI_TOOLS,
            tool_choice: "auto"
        };

        const controller1 = new AbortController();
        const timeoutId1 = setTimeout(() => controller1.abort(), 300000);

        const signal1 = AbortSignal.any([
            controller1.signal,
            reqAbortController.signal
        ]);

        const response1 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(llmPayload),
            signal: signal1
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
            `, [sessionId, logFacilityId, logDepartmentCode, (aiMessage.content || "").replace(/EMPTY/g, "").trim(), JSON.stringify(aiMessage.tool_calls)]);

            // [SCHEMA FIX]: Thay vì gán "", ta gán khoảng trắng " " để không bị Gemini bắt lỗi empty text part
            if (!aiMessage.content || aiMessage.content.trim() === "" || aiMessage.content.trim() === "EMPTY") {
                aiMessage.content = " ";
            }
            messages.push(aiMessage); 

            // ==========================================
            // [BẢO MẬT & HIỆU NĂNG - MỤC 1 & 4]: ĐA LUỒNG & RBAC HARD-CODE
            // ==========================================
            const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'];
            const isAllAccess = ALL_ACCESS_ROLES.includes(userContext.role) || 
                                (userContext.role === 'DEPARTMENT_HEAD' && logDepartmentCode === 'MARKETING');

            const toolPromises = aiMessage.tool_calls.map(async (toolCall) => {
                const funcName = toolCall.function.name;
                const funcArgs = safeJsonParse(toolCall.function.arguments, {});

                // [CHỐT CHẶN RBAC THÉP]: Nếu KHÔNG phải Tướng/Soái -> Ép đè Facility & Department bằng JWT Token
                if (!isAllAccess) {
                    funcArgs.facility_id = logFacilityId;
                    funcArgs.facilityId = logFacilityId; 
                    funcArgs.department_code = logDepartmentCode;
                    funcArgs.departmentCode = logDepartmentCode;
                }

                let safeToolResult = "";
                let toolMeta = { tool_call_id: toolCall.id, name: funcName };

                try {
                    const toolResult = await aiService.processToolCall(funcName, funcArgs, userContext);
                    safeToolResult = typeof toolResult === 'object' ? JSON.stringify(toolResult) : String(toolResult);
                } catch (toolError) {
                    console.error(`[TOOL ERROR] Lỗi tại tool ${funcName}:`, toolError.message);
                    safeToolResult = JSON.stringify({ error: `Hệ thống gặp lỗi khi truy xuất dữ liệu từ API nội bộ (${toolError.message}). Hãy tiếp tục phân tích dựa trên các dữ liệu khác.` });
                }

                return {
                    dbArgs: [sessionId, logFacilityId, logDepartmentCode, safeToolResult, JSON.stringify(toolMeta)],
                    msgObj: { tool_call_id: toolCall.id, role: "tool", name: funcName, content: safeToolResult }
                };
            });

            // Kích hoạt tất cả tiến trình lấy Data chạy CÙNG LÚC
            const resolvedTools = await Promise.all(toolPromises);

            // [LƯU DB TUẦN TỰ]: Sau khi Data đã gom đủ, lưu lần lượt vào DB để bảo vệ Connection Pool & giữ đúng trật tự Causality
            for (const resolved of resolvedTools) {
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, tool_calls)
                    VALUES ($1, $2, $3, 'tool', $4, $5)
                `, resolved.dbArgs);
                messages.push(resolved.msgObj);
            }

            // Thêm một tin nhắn hệ thống vào cuối cùng để dặn dò Gemini không gọi tool nữa
            messages.push({
                role: "system",
                content: "Dữ liệu công cụ đã được trả về đầy đủ. BẮT BUỘC KHÔNG ĐƯỢC GỌI THÊM BẤT KỲ CÔNG CỤ NÀO NỮA. Hãy trực tiếp phân tích dữ liệu và trả lời người dùng bằng văn bản."
            });

            const llmStreamPayload = {
                model: aiModel,
                messages: messages,
                tools: aiService.AI_TOOLS, // Bắt buộc phải có tools nếu lịch sử có tool_calls
                // tool_choice: "none" -> BỎ vì gây lỗi trên OpenRouter với Gemini
                stream: true,
                max_tokens: 4096
            };

            const controller2 = new AbortController();
            const timeoutId2 = setTimeout(() => controller2.abort(), 300000);

            const signal2 = AbortSignal.any([
                controller2.signal,
                reqAbortController.signal
            ]);

            const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(llmStreamPayload),
                signal: signal2
            });

            if (!response2.ok) {
                clearTimeout(timeoutId2);
                const errText = await response2.text();
                throw new Error(`API LLM (Lượt Stream) lỗi ${response2.status}: ${errText}`);
            }
            
            try {
                // 4. KHẮC PHỤC BUG 4: ASYNC ACCUMULATOR CHỐNG RÁCH CHUỖI VÀ ĐỒNG BỘ LUỒNG
                if (isClientConnected) {
                    const reader = response2.body;
                    let streamBuffer = ""; 
                    
                    // Sử dụng Async Iterable thay vì listener on('data') để khóa luồng thực thi
                    for await (const chunkBuffer of reader) {
                        if (!isClientConnected) {
                            if (controller2 && typeof controller2.abort === 'function') controller2.abort();
                            break;
                        }

                        // Tích lũy đệm
                        streamBuffer += chunkBuffer.toString();
                        
                        let boundaryIndex;
                        // Phá vách kép \n\n
                        while ((boundaryIndex = streamBuffer.indexOf('\n\n')) !== -1) {
                            const completeEvent = streamBuffer.slice(0, boundaryIndex).trim();
                            // Lưu trữ mảnh vỡ chưa hoàn thành cho vòng for kế
                            streamBuffer = streamBuffer.slice(boundaryIndex + 2);
                            
                            if (!completeEvent) continue;
                            
                            if (completeEvent.startsWith('data: ')) {
                                const dataStr = completeEvent.slice(6).trim();
                                if (dataStr === '[DONE]') continue;
                                
                                try {
                                    const data = JSON.parse(dataStr);
                                    
                                    const delta = data?.choices?.[0]?.delta;
                                    // [LƯỚI ĐIỆN VẬT LÝ]: Radar Chống Mù Parser & Kill-Switch
                                    if (delta && delta.tool_calls) {
                                        console.warn('[SECURITY WARNING]: AI đang cố gắng vượt rào gọi hàm đệ quy trong luồng stream.');
                                        if (isClientConnected) {
                                            const errMsg = "Cảnh báo An ninh: AI đang cố gắng trích xuất dữ liệu vượt ranh giới phân quyền. Tác vụ đã bị chặn bởi hệ thống phòng thủ HUBDB.";
                                            res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
                                            res.write('data: [DONE]\n\n');
                                            res.end();
                                        }
                                        if (controller2 && typeof controller2.abort === 'function') controller2.abort();
                                        throw new Error("KILL_SWITCH_TRIGGERED"); // Ném lỗi văng ra catch để chạy mượt xuống finally
                                    }

                                    const contentChunk = delta?.content || data?.content || "";
                                    if (contentChunk) {
                                        fullAiReply += contentChunk;
                                        res.write(`data: ${JSON.stringify({ content: contentChunk })}\n\n`);
                                    }
                                } catch (e) {
                                    console.error('[STREAM PARSE ERROR] Đã bảo vệ luồng:', e.message);
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                 if (err.message !== "KILL_SWITCH_TRIGGERED") throw err;
            } finally {
                clearTimeout(timeoutId2);
                // BẮT BUỘC ĐỢI STREAM TRẢ HẾT / GÃY RỒI MỚI CHẠY LƯU DB CHỐNG ASYNC LEAK
                await saveAiReplyToDb(); 
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
                ? "Kết nối AI quá tải (Timeout 300s). Đã kích hoạt cơ chế bảo vệ UI. Xin thử lại." 
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
        const safeFacilityId = parseSafeFacilityId(req.user.facility_id);
        
        // 1. KHẮC PHỤC BUG 1: BĂM UUID 
        const sessionId = crypto.randomUUID(); 
        const currentTimestamp = Date.now();
        
        const { rows } = await pool.query(
            'INSERT INTO ai_chat_sessions (id, title, facility_id, user_id, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING *', 
            [sessionId, 'Phiên AI mới', safeFacilityId, req.user.id, currentTimestamp]
        );
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error("[CRITICAL] Lỗi tạo Session thủ công (REST API):", error.message);
        return res.status(500).json({ 
            success: false, 
            message: '[LỖI HỆ THỐNG]: Không thể khởi tạo Phiên Chat mới do sự cố phân quyền hoặc CSDL.' 
        });
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
