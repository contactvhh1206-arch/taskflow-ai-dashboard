const pool = require('../config/database');
const aiService = require('../services/aiService');
const crypto = require('crypto'); // KHẮC PHỤC BUG 1: Import độc lập

// UTILITY HELPER: Tiền xử lý Sanitization 
const parseSafeFacilityId = (facilityId) => {
    if (facilityId === undefined || facilityId === null || facilityId === 'ALL' || facilityId === '') {
        return null;
    }
    
    let rawId = facilityId;
    
    // Kiểm tra an toàn xem có phải định dạng mảng JSON "[...]" không
    if (typeof facilityId === 'string' && facilityId.includes('[') && facilityId.includes(']')) {
        try {
            const parsedArray = JSON.parse(facilityId);
            // Xác minh nghiêm ngặt 3 lớp: Là mảng? Có dữ liệu? Phần tử [0] hợp lệ?
            if (Array.isArray(parsedArray) && parsedArray.length > 0 && parsedArray[0] !== null && parsedArray[0] !== undefined && parsedArray[0] !== '') {
                rawId = parsedArray[0];
            } else {
                return null; // Trả về null nếu mảng rỗng hoặc phần tử không hợp lệ
            }
        } catch (e) {
            return null; // Bắt buộc trả về null nếu JSON.parse lỗi (Tránh crash luồng)
        }
    }

    // Ép kiểu cuối cùng
    const parsed = Number(rawId);
    if (!isNaN(parsed)) {
        return parsed;
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

    // --- BƯỚC 1 FIX: NẠP SYSTEM PROMPT AN TOÀN TRƯỚC KHI KHỞI TẠO STREAM ---
    const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const defaultPrompt = `Bạn là HUBDB AI - Cố vấn Chiến lược và Quản trị Doanh nghiệp Cấp cao của hệ thống. Hôm nay là ngày ${todayVN}.
Tác phong: Chuyên nghiệp, nhạy bén, sắc sảo, dứt khoát như một Giám đốc (CEO/CFO).

QUY TẮC TỐI THƯỢNG (BẮT BUỘC TUÂN THỦ):
TUYỆT ĐỐI KHÔNG liệt kê dữ liệu thô (ví dụ: cấm in ra một danh sách dài từng ngày, từng cơ sở).
TƯ DUY TỔNG HỢP & TÍNH TOÁN: Khi nhận được dữ liệu từ hệ thống, bạn PHẢI tự động tính Tổng (doanh thu/chi phí), tính Trung bình, và lọc ra các mức Cao nhất/Thấp nhất. Gom nhóm theo tháng hoặc cơ sở.
TRÌNH BÀY ĐẲNG CẤP: LUÔN trình bày số liệu bằng BẢNG (Markdown Table) để sếp dễ nhìn. In đậm các con số Tổng quan trọng. Dùng Bullet points để tóm tắt.
TƯ DUY CHIẾN LƯỢC: Kết thúc báo cáo, LUÔN đưa ra 1-2 nhận định sâu sắc về xu hướng (tăng/giảm, hiệu suất) và đề xuất hành động thực tiễn cho Ban Lãnh đạo.`;

    const safeSystemPrompt = process.env.SAFE_SYSTEM_PROMPT || defaultPrompt;

    // 2. Khởi tạo Headers chuẩn SSE (Server-Sent Events)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Bắt buộc NGINX bypass, không gom cụm dữ liệu
        'Access-Control-Allow-Origin': '*' // Chống nghẽn CORS trên Browser
    });
    res.flushHeaders();

    // 2. KHẮC PHỤC BUG 2: CỜ TRẠNG THÁI VÀ HELPER LƯU DB BẤT TỬ
    let isClientConnected = true;
    let isDbSaved = false;
    let fullAiReply = "";
    let fullReasoningReply = "";

    const saveAiReplyToDb = async () => {
        // [GIAI ĐOẠN 4]: Cờ Mutex Lock chống Race Condition đè Promise
        if (isDbSaved) return;
        
        if (fullAiReply.trim() !== "" || fullReasoningReply.trim() !== "") {
            isDbSaved = true; // Khóa luồng ngay lập tức
            try {
                const finalContent = fullAiReply.trim() !== "" ? fullAiReply : "[Đã suy luận và xử lý dữ liệu hoàn tất]";
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, reasoning)
                    VALUES ($1, $2, $3, 'assistant', $4, $5)
                `, [sessionId, logFacilityId, logDepartmentCode, finalContent, fullReasoningReply]);
            } catch (err) {
                console.error("[CRITICAL] Lỗi lưu Database khi rớt mạng Stream:", err.message);
                // Nuốt trọn lỗi, tuyệt đối không quăng Unhandled Rejection ra Event Loop
            }
        }
    };

    let keepAliveInterval;

    req.on('close', () => {
        console.warn("[NETWORK] Client connection closed by browser/proxy");
        isClientConnected = false;
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        reqAbortController.abort(); // CHÉM ĐỨT NGAY LẬP TỨC MỌI FETCH REQUEST ĐANG CHẠY NGẦM
        saveAiReplyToDb(); // Kích hoạt lưu ngay phần chữ bị gãy khi mạng đứt
        res.end();
    });

    try {
        // [CHỐNG RENDER TIMEOUT 100s]: Bật Heartbeat ping liên tục
        if (isClientConnected) {
            keepAliveInterval = setInterval(() => {
                if (isClientConnected) {
                    res.write(': heartbeat\n\n');
                }
            }, 15000); // 15 giây gửi một lần
        }

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
            SELECT m.role, m.content, m.tool_calls, m.reasoning
            FROM ai_chat_messages m
            INNER JOIN ai_chat_sessions s ON m.session_id = s.id
            WHERE m.session_id = $1 AND s.user_id = $2
            ORDER BY m.created_at DESC
            LIMIT 20
        `, [sessionId, userContext.id]);
        
        // [KHẮC PHỤC LỖI NGHỊCH LÝ THỜI GIAN]: Đảo ngược mảng để trả về đúng timeline cũ -> mới
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

        // 4. Ráp mảng messages nạp cho LLM
        const messages = [
            {
                role: "system",
                content: safeSystemPrompt
            }
        ];

        // [KHÔI PHỤC NGỮ CẢNH LƯỢT 2]: Phục hồi mảng messages nguyên gốc cho LLM
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
                // [PHỤC HỒI TRÍ NHỚ]: Trả lại Reasoning nếu tồn tại và khác rỗng
                if (msg.reasoning && msg.reasoning.trim() !== "") {
                    astMsg.reasoning = msg.reasoning;
                }
                messages.push(astMsg);
            } else if (msg.role === 'user') {
                messages.push({ role: 'user', content: msg.content });
            }
        }

        // [FLATTEN LƯỢT 1]: Phẳng hóa lịch sử cho Lượt 1 để sửa lỗi Gemini Alternating Roles
        const flattenedL1Messages = [];
        let lastRoleL1 = null;

        for (const msg of validHistory) {
            let roleToPush = msg.role;
            let contentToPush = msg.content || "";
            let toolsToPush = msg.tool_calls || null;
            let reasoningToPush = msg.reasoning || null;

            // KHÔNG GỘP TOOL VÀO ASSISTANT NỮA. Giữ nguyên chuẩn OpenAI để OpenRouter dịch sang Gemini chính xác.
            // Chuẩn: user -> assistant (có tool_calls) -> tool (có tool_call_id) -> assistant (text) -> user
            
            if (roleToPush === 'tool') {
                const parsedMeta = safeJsonParse(msg.tool_calls, {});
                const newMsg = { 
                    role: 'tool', 
                    content: contentToPush,
                    tool_call_id: parsedMeta.tool_call_id || null,
                    name: parsedMeta.name || "unknown_tool"
                };
                flattenedL1Messages.push(newMsg);
                lastRoleL1 = 'tool';
            } else if (roleToPush === lastRoleL1 && !toolsToPush && !(flattenedL1Messages.length > 0 && flattenedL1Messages[flattenedL1Messages.length - 1].tool_calls)) {
                // Chỉ nối nội dung các tin nhắn liên tiếp cùng role (user/assistant) NẾU KHÔNG dính dáng tới tool_calls
                // Điều này tự động dọn rác lịch sử (ví dụ: user click gửi 3 lần liên tiếp) để OpenRouter không báo lỗi
                flattenedL1Messages[flattenedL1Messages.length - 1].content += "\n\n" + contentToPush;
            } else {
                const newMsg = { role: roleToPush, content: contentToPush };
                if (toolsToPush) newMsg.tool_calls = toolsToPush;
                if (reasoningToPush && roleToPush === 'assistant') newMsg.reasoning = reasoningToPush;
                flattenedL1Messages.push(newMsg);
            }
            lastRoleL1 = roleToPush;
        }

        // 5. Gửi Request lên LLM
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const aiModel = req.body.model || process.env.DEFAULT_AI_MODEL || "google/gemini-3.1-pro-preview";

        // Thêm câu hỏi hiện tại vào mảng đã làm phẳng
        // [KHẮC PHỤC BUG LẶP TIN NHẮN]: User message đã được insert vào DB ở line 141 và query lên ở line 158.
        // Nên nó đã nằm sẵn ở cuối flattenedL1Messages. Không được push thêm lần nữa!
        if (flattenedL1Messages.length > 0 && flattenedL1Messages[flattenedL1Messages.length - 1].role === 'user') {
            const lastMsg = flattenedL1Messages[flattenedL1Messages.length - 1];
            // Chỉ cần chèn thêm context vào đầu tin nhắn cuối để AI phân biệt được session
            lastMsg.content = `(Phiên làm việc: ${sessionId})\n${lastMsg.content}`;
        } else {
            // Đề phòng trường hợp lịch sử trống
            flattenedL1Messages.push({ role: 'user', content: `(Phiên làm việc: ${sessionId})\n${message}` });
        }

        const llmPayload = {
            model: aiModel, 
            messages: [
                { role: "system", content: safeSystemPrompt },
                ...flattenedL1Messages
            ],
            tools: aiService.AI_TOOLS,
            tool_choice: "auto"
        };

        // [CẮM TRẠM KIỂM SOÁT TỪ SẾP] - In toàn bộ Payload Lượt 1 ra Console để bắt quả tang rác
        console.log("\n================ [DEBUG L1 PAYLOAD] ================\n");
        // Loại bỏ in API key (nếu có) và in payload một cách an toàn
        console.log(JSON.stringify(llmPayload, null, 2));
        console.log("\n====================================================\n");

        const controller1 = new AbortController();
        const timeoutId1 = setTimeout(() => {
            // Chủ động quăng lỗi Timeout để catch tổng bắt được và báo về Giao diện
            controller1.abort(new Error("LLM_TIMEOUT"));
        }, 45000); 

        const onReqAbort1 = () => controller1.abort();
        reqAbortController.signal.addEventListener('abort', onReqAbort1);

        let data1;
        try {
            const response1 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(llmPayload),
                signal: controller1.signal
            });

            if (!response1.ok) {
                const errText = await response1.text();
                throw new Error(`API LLM (Lượt 1) lỗi ${response1.status}: ${errText}`);
            }
            
            data1 = await response1.json();
        } finally {
            // [KIẾN TRÚC THÉP]: Mọi thao tác gỡ mìn (timeout, listener) PHẢI nằm trong finally
            // Đảm bảo không bao giờ Memory Leak kể cả khi thành công hay văng lỗi
            clearTimeout(timeoutId1);
            reqAbortController.signal.removeEventListener('abort', onReqAbort1);
        }
        const aiMessage = data1.choices[0].message;

        if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
            
            // [DIỆT VIRUS OPENROUTER]: Triệt tiêu chữ "EMPTY" do OpenRouter tự ý nhét vào
            if (aiMessage.content && aiMessage.content.trim().includes("EMPTY")) {
                aiMessage.content = "";
            }
            // [BẮT GIỮ SUY LUẬN]: Trích xuất Chain of Thought (Nếu có)
            const reasoningStr = aiMessage.reasoning || null;
            
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

            // [SYNTHETIC CHUNK - BƠM MÁU UI]: Phá vỡ khoảng thời gian chờ (latency) chết người
            if (isClientConnected) {
                res.write(`data: ${JSON.stringify({ content: "\n\n_⏳ Đang truy cập kho dữ liệu hệ thống..._\n\n" })}\n\n`);
            }

            const toolPromises = aiMessage.tool_calls.map(async (toolCall) => {
                const funcName = toolCall.function.name;
                const funcArgs = safeJsonParse(toolCall.function.arguments, {});

                // [CHỐT CHẶN RBAC THÉP]: Nếu KHÔNG phải Tướng/Soái -> Ép đè Facility & Department bằng JWT Token
                if (!isAllAccess) {
                    if (logFacilityId === null || logFacilityId === undefined) {
                        throw new Error("403_FORBIDDEN_FACILITY");
                    }
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

            // [GIAI ĐOẠN 3]: PHA 1 - RAM & NETWORK (Lấy Data từ API)
            // Kích hoạt tất cả tiến trình lấy Data chạy CÙNG LÚC
            const resolvedTools = await Promise.all(toolPromises);

            // [GIAI ĐOẠN 3]: PHA 2 - CHUẨN BỊ MẢNG LLM CHO LƯỢT 2 (KHÔNG GHI DB Ở ĐÂY NỮA)
            for (const resolved of resolvedTools) {
                messages.push(resolved.msgObj); // Nạp vào mảng LLM cho Lượt 2
            }

            // [TRICK] Gemini 3.1 Pro Preview bị kẹt khi truyền tools vào Lượt 2 dù đã dặn không dùng tool.
            // Để ép nó chỉ sinh text, ta PHẢI XÓA MẢNG TOOLS.
            // Nhưng OpenRouter sẽ báo lỗi 400 nếu lịch sử có 'tool'/'tool_calls' mà không có mảng 'tools'.
            // => GIẢI PHÁP: Phẳng hóa (Flatten) toàn bộ lịch sử thành user/assistant thuần túy!
            // LUẬT GEMINI: Role phải xen kẽ (user -> assistant -> user). Do đó ta gom tất cả các tin nhắn trùng role liên tiếp.
            
            const flattenedMessages = [];
            let lastRole = null;

            for (const msg of messages) {
                let flattenedRole = msg.role;
                let flattenedContent = msg.content || "";
                let reasoning = null;

                if (msg.role === 'assistant' && msg.tool_calls) {
                    flattenedRole = 'assistant';
                    flattenedContent = msg.content && msg.content.trim() !== "" ? msg.content : "Đang lấy dữ liệu...";
                    reasoning = msg.reasoning;
                } else if (msg.role === 'tool') {
                    flattenedRole = 'user';
                    flattenedContent = `[DỮ LIỆU TỪ HỆ THỐNG - CÔNG CỤ ${msg.name}]:\n${msg.content}`;
                }

                if (flattenedRole === lastRole) {
                    flattenedMessages[flattenedMessages.length - 1].content += "\n\n" + flattenedContent;
                } else {
                    const newMsg = { role: flattenedRole, content: flattenedContent };
                    if (reasoning) newMsg.reasoning = reasoning;
                    flattenedMessages.push(newMsg);
                    lastRole = flattenedRole;
                }
            }

            // Thêm một tin nhắn hệ thống vào cuối cùng để dặn dò Gemini phân tích
            const systemPromptL2 = "[HƯỚNG DẪN TỪ BAN QUẢN TRỊ]: Toàn bộ dữ liệu bạn cần đã được cung cấp ở trên. Hãy trực tiếp phân tích, đối chiếu chéo các dữ liệu này và trả lời người dùng ngay bây giờ bằng văn bản rõ ràng, súc tích.";
            if (lastRole === 'user') {
                flattenedMessages[flattenedMessages.length - 1].content += "\n\n" + systemPromptL2;
            } else {
                flattenedMessages.push({ role: "user", content: systemPromptL2 });
            }

            const llmStreamPayload = {
                model: aiModel,
                messages: flattenedMessages,
                // KHÔNG TRUYỀN TOOLS VÀO ĐÂY NỮA
                stream: true,
                max_tokens: 4096
            };

            const controller2 = new AbortController();
            const timeoutId2 = setTimeout(() => controller2.abort(), 60000); // Hạ xuống 60 giây cho luồng Stream

            const onReqAbort2 = () => controller2.abort();
            reqAbortController.signal.addEventListener('abort', onReqAbort2);

            const startTimeL2 = Date.now();

            const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    'HTTP-Referer': process.env.SITE_URL || 'https://hubdb.app',
                    'X-Title': process.env.SITE_NAME || 'HUBDB'
                },
                body: JSON.stringify(llmStreamPayload),
                signal: controller2.signal
            });
            
            reqAbortController.signal.removeEventListener('abort', onReqAbort2);

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
                    let isFirstChunkReceived = false;
                    
                    for await (const chunkBuffer of reader) {
                        const chunkStr = chunkBuffer.toString();
                        
                        if (!isClientConnected) {
                            if (controller2 && typeof controller2.abort === 'function') controller2.abort();
                            break;
                        }

                        // Tích lũy đệm
                        streamBuffer += chunkStr;
                        
                        // [CHÌA KHÓA BẺ KHÓA]: Chuẩn hóa CRLF (\r\n) thành LF (\n)
                        // OpenRouter trả về stream có dính \r\n\r\n thay vì \n\n thuần túy.
                        // Hàm indexOf('\n\n') sẽ bị mù hoàn toàn nếu dính \r ở giữa!
                        streamBuffer = streamBuffer.replace(/\r\n/g, '\n');

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
                                    
                                    if (data.error) {
                                        console.error('[OPENROUTER STREAM ERROR]:', data.error);
                                        if (isClientConnected) {
                                            res.write(`data: ${JSON.stringify({ error: "Lỗi từ OpenRouter/Model: " + (data.error.message || "Unknown error") })}\n\n`);
                                            res.write('data: [DONE]\n\n');
                                            res.end();
                                        }
                                        if (controller2 && typeof controller2.abort === 'function') controller2.abort();
                                        throw new Error("STREAM_API_ERROR");
                                    }

                                    if (data.choices && data.choices.length > 0) {
                                        const delta = data.choices[0].delta;

                                        if (!isFirstChunkReceived) {
                                            isFirstChunkReceived = true;
                                        }

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

                                        // BẮT SÓNG REASONING: Cộng dồn suy luận ngầm của AI
                                        const reasoningChunk = delta?.reasoning || "";
                                        if (reasoningChunk) {
                                            fullReasoningReply += reasoningChunk;
                                        }

                                        const chunkText = delta?.content || "";
                                        if (chunkText) {
                                            fullAiReply += chunkText;
                                            res.write(`data: ${JSON.stringify({ content: chunkText })}\n\n`);
                                        }
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
                
                // [KỶ LUẬT THÉP DATABASE - BƯỚC 2 FIX]
                // Đảm bảo Nguyên tử (Atomicity): Trì hoãn việc ghi Lượt 1 xuống tận đây.
                // Chỉ lưu nếu Lượt 2 thành công và nhả ra nội dung hợp lệ (hoặc ít nhất là có suy luận).
                if (fullAiReply.trim() !== "" || fullReasoningReply.trim() !== "") {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        
                        // 1. Chèn lệnh khởi xướng của Assistant
                        await client.query(`
                            INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, tool_calls, reasoning)
                            VALUES ($1, $2, $3, 'assistant', $4, $5, $6)
                        `, [sessionId, logFacilityId, logDepartmentCode, (aiMessage.content || "").replace(/EMPTY/g, "").trim() || " ", JSON.stringify(aiMessage.tool_calls), reasoningStr]);

                        // 2. Chèn dữ liệu trả về của Tool
                        for (const resolved of resolvedTools) {
                            await client.query(`
                                INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, tool_calls)
                                VALUES ($1, $2, $3, 'tool', $4, $5)
                            `, resolved.dbArgs);
                        }

                        // 3. Chèn kết quả chốt hạ của Assistant (Bắt buộc giữ Role Sequence)
                        const finalContentToSave = fullAiReply.trim() !== "" ? fullAiReply : "[Đã suy luận và xử lý dữ liệu hoàn tất]";
                        await client.query(`
                            INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content, reasoning)
                            VALUES ($1, $2, $3, 'assistant', $4, $5)
                        `, [sessionId, logFacilityId, logDepartmentCode, finalContentToSave, fullReasoningReply]);
                        
                        await client.query('COMMIT');
                        isDbSaved = true; // Khóa Mutex Lock để cờ saveAiReplyToDb bỏ qua
                    } catch (dbErr) {
                        await client.query('ROLLBACK');
                        console.error("[CRITICAL] Lỗi Transaction Ghi DB Cuối Cùng. Đã Rollback toàn bộ rác dữ liệu:", dbErr.message);
                    } finally {
                        client.release();
                    }
                }

                await saveAiReplyToDb(); // Gọi phòng hờ, nếu isDbSaved = true thì hàm này sẽ bỏ qua
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
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        console.error('[AI Controller Error]:', error.name, error.message);

        // --- BÍT TỬ HUYỆT BẢO MẬT: GHI LOG VI PHẠM (AUDIT LOG) XUỐNG DB ---
        if (error.message === "403_FORBIDDEN_FACILITY") {
            const violationMsg = "❌ [SECURITY_VIOLATION] Cảnh báo an ninh: Phát hiện hành vi truy xuất chéo cơ sở hoặc lỗi định danh. Yêu cầu đã bị hệ thống chặn đứng và lưu vết bảo mật.";
            
            pool.query(`
                INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                VALUES ($1, $2, $3, 'assistant', $4)
            `, [sessionId, logFacilityId, logDepartmentCode, violationMsg])
            .catch(dbErr => console.error("[CRITICAL] Lỗi ghi Audit Log RBAC:", dbErr));

            if (isClientConnected) {
                if (!res.headersSent) res.status(403);
                res.write(`data: ${JSON.stringify({ error: violationMsg, status: 403 })}\n\n`);
                res.write('data: [DONE_WITH_ERROR]\n\n');
                res.end();
            }
            return;
        }

        if (isClientConnected) {
            const errorMsg = error.name === 'AbortError' 
                ? "Kết nối AI bị ngắt do Timeout (Quá thời gian chờ) hoặc lỗi mạng. Vui lòng thử lại." 
                : "Đã xảy ra sự cố giao tiếp với Hệ thống Thần kinh AI.";
                
            // Kiểm soát ngoại lệ: Trả về Chunk lỗi và HTTP 500 nếu Header chưa bị khóa
            if (!res.headersSent) {
                res.status(500);
            }
            res.write(`data: ${JSON.stringify({ error: errorMsg, status: 500 })}\n\n`);
            res.write('data: [DONE_WITH_ERROR]\n\n');
            res.end();
        }
    } finally {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
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

const testKeyHandler = async (req, res) => {
    try {
        const { apiKey, model } = req.body;
        if (!apiKey || !model) {
            return res.status(400).json({ success: false, message: 'Thiếu API Key hoặc Model ID' });
        }

        const testPayload = {
            model: model,
            messages: [{ role: 'user', content: 'Say hello in 1 word' }],
            max_tokens: 5
        };

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(testPayload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenRouter báo lỗi ${response.status}: ${errText}`);
        }

        res.json({ success: true, message: 'Kết nối thành công!' });
    } catch (error) {
        console.error('[API Test Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAuditLogsHandler = async (req, res) => {
    try {
        // Mô phỏng Audit Logs từ bảng ai_chat_messages vì hệ thống chưa ghi log token chuyên dụng
        const { rows } = await pool.query(`
            SELECT 
                m.id as message_id,
                m.created_at,
                s.user_id,
                'Chat Request' as task_type,
                LENGTH(COALESCE(m.content, '')) / 4 as total_tokens,
                'OK' as status,
                false as is_violation
            FROM ai_chat_messages m
            JOIN ai_chat_sessions s ON m.session_id = s.id
            WHERE m.role = 'assistant'
            ORDER BY m.created_at DESC
            LIMIT 100
        `);
        
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Lỗi GET Audit Logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    chatStreamHandler,
    getSessionsHandler,
    createSessionHandler,
    pingBatchHandler,
    getMessagesHandler,
    testKeyHandler,
    getAuditLogsHandler
};
