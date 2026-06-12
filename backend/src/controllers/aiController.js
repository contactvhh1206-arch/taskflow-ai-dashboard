const pool = require('../config/database');
const aiService = require('../services/aiService');
const crypto = require('crypto');
const ragService = require('../services/ragService');

// [FIX VẤN ĐỀ 4] Cache cấu hình AI từ DB (Singleton Pattern, TTL = 5 phút)
// Tránh gọi DB mỗi request — chỉ tải lại khi cache hết hạn hoặc chưa có
let _aiConfigCache = null;
let _lastCacheTime = 0;
const AI_CONFIG_TTL = 5 * 60 * 1000; // 5 phút

const getAIConfig = async () => {
    const now = Date.now();
    if (_aiConfigCache && (now - _lastCacheTime < AI_CONFIG_TTL)) {
        return _aiConfigCache;
    }
    try {
        const { rows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
        const raw = rows.length > 0 ? rows[0].data : {};
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        _aiConfigCache = {
            // Frontend lưu vưới key là 'aiModel' (ApiConfigPanel.jsx dòng 106)
            model: parsed.aiModel || parsed.model || process.env.DEFAULT_AI_MODEL || 'google/gemini-3.1-pro-preview',
            apiKey: parsed.apiKey || process.env.OPENROUTER_API_KEY
        };
        _lastCacheTime = now;
        return _aiConfigCache;
    } catch (err) {
        console.error('[getAIConfig] Lỗi đọc DB, dùng fallback:', err.message);
        return {
            model: process.env.DEFAULT_AI_MODEL || 'google/gemini-3.1-pro-preview',
            apiKey: process.env.OPENROUTER_API_KEY
        };
    }
};

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

// [MỚI] HELPER TỐI ƯU CHUỖI TIẾNG VIỆT
const normalizeName = (str) => {
    if (!str) return '';
    return str.toString()
        .normalize('NFD') // Tách dấu ra khỏi ký tự
        .replace(/[\u0300-\u036f]/g, '') // Xóa dấu
        .toLowerCase() // Đưa về chữ thường
        .trim(); // Xóa khoảng trắng thừa
};

const chatStreamHandler = async (req, res) => {
    const message = req.body.message;
    const attachment = req.body.attachment;
    let { sessionId, session_id } = req.body;
    sessionId = sessionId || session_id;
    const userContext = req.user;

    if (!message) {
        return res.status(400).json({ success: false, message: "Bad Request: Thiếu message." });
    }

    const safeFacilityId = parseSafeFacilityId(userContext.facility_id);
    const logDepartmentCode = userContext.department_code || null;
    const logFacilityId = safeFacilityId;

    let isNewSession = false;
    
    if (!sessionId) {
        try {
            sessionId = crypto.randomUUID(); 
            const currentTimestamp = Date.now();
            await pool.query(
                'INSERT INTO ai_chat_sessions (id, title, facility_id, user_id, timestamp) VALUES ($1, $2, $3, $4, $5)', 
                [sessionId, 'Phiên AI mới', safeFacilityId, userContext.id, currentTimestamp]
            );
            isNewSession = true;
        } catch (e) {
            console.error("[CRITICAL] Lỗi khởi tạo Session tự động (SSE):", e.message);
            res.status(500).json({ error: "[LỖI HỆ THỐNG]: Không thể khởi tạo Phiên Chat mới." });
            return;
        }
    }

    let isDbSaved = false;
    let fullAiReply = "";

    const saveAiReplyToDb = async () => {
        if (isDbSaved) return;
        if (fullAiReply.trim() !== "") {
            isDbSaved = true; 
            try {
                await pool.query(`
                    INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
                    VALUES ($1, $2, $3, 'assistant', $4)
                `, [sessionId, logFacilityId, logDepartmentCode, fullAiReply]);
            } catch (err) {
                console.error("[CRITICAL] Lỗi lưu Database khi rớt mạng Stream:", err.message);
            }
        }
    };

    req.on('close', () => {
        saveAiReplyToDb();
    });

    try {
        // 1. Lưu tin nhắn User vào DB và Cập nhật thời gian Session
        await pool.query(`
            INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
            VALUES ($1, $2, $3, 'user', $4)
        `, [sessionId, logFacilityId, logDepartmentCode, message]);

        await pool.query(
            'UPDATE ai_chat_sessions SET timestamp = $1 WHERE id = $2',
            [Date.now(), sessionId]
        );

        // 2. Lấy lịch sử 20 tin nhắn gần nhất để tạo bối cảnh (Context)
        const { rows: historyRows } = await pool.query(`
            SELECT m.role, m.content
            FROM ai_chat_messages m
            INNER JOIN ai_chat_sessions s ON m.session_id = s.id
            WHERE m.session_id = $1 AND s.user_id = $2
            ORDER BY m.created_at DESC
            LIMIT 20
        `, [sessionId, userContext.id]);
        
        historyRows.reverse();

        // 3. CHÈN DỮ LIỆU TỰ ĐỘNG (Pre-flight RAG)
        let dbContextStr = "";
        try {
            // FIX BUG 1: Chỉ quét trên câu hỏi hiện tại, tránh Double Coding gọi DB 1000 lần liên tục do dư âm từ khóa cũ
            const lowerMsg = message.toLowerCase();
            
            let isRevenueContext = false;
            if (historyRows.length > 0) {
                const lastMsg = historyRows[historyRows.length - 1].content.toLowerCase();
                if (lastMsg.includes('doanh thu') || lastMsg.includes('tài chính') || lastMsg.includes('báo cáo')) {
                    isRevenueContext = true;
                }
            }

            const hasRevenueKeyword = lowerMsg.includes('doanh thu') || lowerMsg.includes('tài chính') || lowerMsg.includes('tiền') || lowerMsg.includes('báo cáo') || lowerMsg.includes('chi tiết') || lowerMsg.includes('tuần') || lowerMsg.includes('ngày') || lowerMsg.includes('tháng');
            const hasConfirmationKeyword = lowerMsg.includes('ok') || lowerMsg.includes('có') || lowerMsg.includes('đồng ý') || lowerMsg.includes('xem') || lowerMsg.includes('trích xuất');

            if (hasRevenueKeyword || (isRevenueContext && hasConfirmationKeyword)) {
                // [FIX VẤN ĐỀ 1] Bước 1: Xác định đúng tháng mục tiêu
                const now = new Date();
                const currentMonth = now.getMonth() + 1; // 1-12
                const currentYear = now.getFullYear();

                let targetMonth = null;
                let targetYear = currentYear;

                // Ưu tiên 1: Trích xuất số tháng cụ thể (VD: "tháng 5", "tháng 12")
                const monthMatch = lowerMsg.match(/tháng\s*(\d{1,2})/);
                if (monthMatch) {
                    targetMonth = parseInt(monthMatch[1], 10);
                }

                // Ưu tiên 2: Nhận diện từ khóa mang nghĩa "tháng này" -> gán tháng hiện tại
                const isCurrentMonthKeyword = lowerMsg.includes('tháng này') || lowerMsg.includes('tháng hiện tại') || lowerMsg.includes('trong tháng') || lowerMsg.includes('tháng hiện hành') || lowerMsg.includes('tháng nay');
                if (!targetMonth && isCurrentMonthKeyword) {
                    targetMonth = currentMonth;
                }

                // Ưu tiên 3: Không có từ khóa thời gian nào -> mặc định về tháng hiện tại
                if (!targetMonth) {
                    targetMonth = currentMonth;
                }

                // [FIX VẤN ĐỀ 1] Bước 2: Tính toán start_date/end_date chính xác cho tháng mục tiêu
                const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
                const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
                const fmt = (d) => d.toISOString().split('T')[0]; // Định dạng YYYY-MM-DD
                const targetStartDate = fmt(startOfMonth);
                const targetEndDate = fmt(endOfMonth);

                const revSummary = await aiService.processToolCall('fetch_revenue_summary', { month: targetMonth, year: targetYear }, userContext);
                if (!revSummary.includes('Không có dữ liệu') && !revSummary.includes('không có dữ liệu')) {
                    dbContextStr += "\n\n[DỮ LIỆU TỔNG DOANH THU CHUẨN (TỪ DASHBOARD)]:\n" + revSummary;
                }

                // [FIX VẤN ĐỀ 1] Bước 3: Truyền đúng mốc thời gian vào fetch_financial_reports,
                // tránh để trống khiến aiService quét toàn bộ DB rồi cộng dồn sai tháng
                const revDetails = await aiService.processToolCall('fetch_financial_reports', { start_date: targetStartDate, end_date: targetEndDate, limit: 500 }, userContext);
                if (!revDetails.includes('Không có dữ liệu') && !revDetails.includes('không có dữ liệu')) {
                    dbContextStr += "\n\n[CHI TIẾT DOANH THU THEO TỪNG NGÀY]:\n" + revDetails;
                }
            }
            
            // [FIX VẤN ĐỀ 2] Mở rộng từ khóa kích hoạt để bao gồm cả nhật ký vận hành
            const hasTaskKeyword = lowerMsg.includes('công việc') || lowerMsg.includes('task') || lowerMsg.includes('tiến độ') || lowerMsg.includes('chưa làm');
            const hasOpsKeyword = lowerMsg.includes('nhật ký') || lowerMsg.includes('vận hành') || lowerMsg.includes('chuyên cần') || lowerMsg.includes('ca làm') || lowerMsg.includes('thiết bị') || lowerMsg.includes('sự cố') || lowerMsg.includes('vệ sinh') || lowerMsg.includes('ktv') || lowerMsg.includes('lễ tân') || lowerMsg.includes('chấm công') || lowerMsg.includes('tổng quan');
            if (hasTaskKeyword || hasOpsKeyword) {
                const taskData = await aiService.processToolCall('fetch_kanban_tasks', { limit: 500 }, userContext);
                if (!taskData.includes('Không có công việc nào')) {
                    dbContextStr += "\n\n[DỮ LIỆU CÔNG VIỆC & NHẬT KÝ VẬN HÀNH]:\n" + taskData;
                }
            }

            // [MỚI] TRUY VẤN RAG TÀI LIỆU (TỪ DATABASE CHUẨN)
            const ragResults = await ragService.searchKnowledgeBase(message, userContext, 3);
            if (ragResults && ragResults.length > 0) {
                const ragTexts = ragResults.filter(r => r.content && !r.content.startsWith('Hệ thống từ chối')).map(r => r.content);
                if (ragTexts.length > 0) {
                    dbContextStr += "\n\n[DỮ LIỆU NỘI BỘ THAM KHẢO (RAG)]:\n" + ragTexts.join('\n---\n');
                }
            }
        } catch (e) {
            console.error("Lỗi chèn RAG tự động:", e.message);
        }

        // 4. Tạo System Prompt có RAG
        const currentTimeString = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        // [FIX VẤN ĐỀ 3 - NGUYÊN NHÂN 1] Làm mềm ngôn ngữ System Prompt để tránh kích hoạt
        // Safety Filter của Gemini — từ ngữ cực đoan ("lỗ hổng vận hành", "TUYỆT ĐỐI") khiến
        // model tự kiểm duyệt và cắt stream giữa chừng mà không báo lỗi ra ngoài
        const systemPrompt = `Bạn là Cố vấn AI Cấp cao của TaskFlow. Thời gian hiện tại: ${currentTimeString}. Role người dùng: ${userContext.role}, Cơ sở: ${safeFacilityId || 'N/A'}.

Nhiệm vụ: Phân tích dữ liệu vận hành và báo cáo chính xác theo 5 nguyên tắc:

1. Trả lời trực tiếp vào số liệu quan trọng nhất ở dòng đầu tiên, không chào hỏi.
2. Nhận định quản trị: Không tường thuật lại số liệu thô. Nêu tối đa 2 đánh giá chuyên sâu về điểm nghẽn hoặc biến động đáng chú ý (sụt giảm bất thường, dữ liệu bị thiếu...).
3. Đề xuất hành động: Đưa ra đúng 1 khuyến nghị điều hành cụ thể để xử lý vấn đề vừa nêu.
4. Nguyên tắc trung thực: Nếu dữ liệu không đủ để kết luận, hãy nói rõ: "Dữ liệu chưa đủ cơ sở để phân tích". Không tự suy luận khi không có căn cứ.
5. Định dạng: Dùng gạch đầu dòng (-), in đậm các con số và chỉ số quan trọng.
${dbContextStr ? '\n\n[DỮ LIỆU HỆ THỐNG]:\n' + dbContextStr : ''}`;

        const messages = [ { role: "system", content: systemPrompt } ];

        let lastRole = "system";
        for (const msg of historyRows) {
            if (msg.role === 'assistant' || msg.role === 'user') {
                if (msg.content && msg.content.trim() !== "") {
                    if (msg.role !== lastRole) {
                        messages.push({ role: msg.role, content: msg.content });
                        lastRole = msg.role;
                    } else {
                        // Merge content if role is the same
                        messages[messages.length - 1].content += "\n\n" + msg.content;
                    }
                }
            }
        }
        
        // FIX BUG 2: Chống Double Coding ghép dính chữ User vào mảng gửi LLM
        // Đảm bảo tin nhắn hiện tại có trong mảng (phòng hờ historyRows thiếu)
        let lastUserMsgContent = message;
        let isContentArray = false;
        
        // Xử lý đính kèm nếu có
        if (attachment) {
            if (attachment.isDoc && attachment.extractedText) {
                lastUserMsgContent += `\n\n[DỮ LIỆU TỪ TỆP ĐÍNH KÈM ${attachment.name}]:\n${attachment.extractedText}`;
            } else if (attachment.url && (attachment.type?.startsWith('image/') || attachment.type?.startsWith('image'))) {
                lastUserMsgContent = [
                    { type: "text", text: message },
                    { type: "image_url", image_url: { url: attachment.url } }
                ];
                isContentArray = true;
            }
        }

        if (messages.length === 1 || (typeof messages[messages.length - 1].content === 'string' && !messages[messages.length - 1].content.includes(message))) {
            if (messages[messages.length - 1].role === 'user' && !isContentArray && typeof messages[messages.length - 1].content === 'string') {
                messages[messages.length - 1].content += "\n\n" + lastUserMsgContent;
            } else {
                messages.push({ role: 'user', content: lastUserMsgContent });
            }
        }

        // FIX BUG 3: Chặn crash Node.js (Cannot set headers after they are sent)
        if (res.headersSent) {
            console.log("[AI Stream] Headers đã được gửi, không thể khởi tạo luồng SSE mới.");
            return;
        }
        if (req.aborted || res.writableEnded) {
            console.log("[AI Stream] Request đã bị hủy hoặc Response đã đóng.");
            return;
        }

        // 5. Trả Headers SSE và Gửi Heartbeat cho Frontend (Bắt đầu Stream)
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', 
            'Access-Control-Allow-Origin': '*'
        });
        res.flushHeaders();

        if (isNewSession && !req.aborted && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ sessionId: sessionId })}\n\n`);
        } else if (!req.aborted && !res.writableEnded) {
            // Gửi heartbeat để đảm bảo kết nối SSE được mở ngay lập tức, chống timeout
            res.write(`: heartbeat\n\n`);
        }

        // [FIX VẤN ĐỀ 4] Đọc model và API key từ system_config DB (có cache 5 phút)
        // Như vậy, bất kỳ thay đổi nào trên giao diện Cài đặt sẽ có hiệu lực sau tối đa 5 phút
        const aiConfig = await getAIConfig();
        // req.body.model chỉ được dùng nếu Frontend chủ động gửi xuống (gọi test API trực tiếp),
        // mặc định là model từ DB
        const aiModel = req.body.model || aiConfig.model;
        const openRouterKey = aiConfig.apiKey;

        // [FIX VẤN ĐỀ 3 - NGUYÊN NHÂN 2] Tăng max_tokens lên 4000 để tránh cắt ngang
        // giữa câu khi phản hồi dài, gây ra hiện tượng văn bản đứt ở giữa ký tự
        const llmPayload = {
            model: aiModel,
            messages: messages,
            stream: true,
            max_tokens: 4000
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json",
                'HTTP-Referer': process.env.SITE_URL || 'https://hubdb.app',
                'X-Title': process.env.SITE_NAME || 'HUBDB'
            },
            body: JSON.stringify(llmPayload),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API LLM lỗi ${response.status}: ${errText}`);
        }

        if (!req.aborted && !res.writableEnded) {
            const reader = response.body;
            let streamBuffer = ""; 
            const decoder = new TextDecoder("utf-8");
            
            for await (const chunkBuffer of reader) {
                if (req.aborted || res.writableEnded) break;
                
                streamBuffer += decoder.decode(chunkBuffer, { stream: true }).replace(/\r\n/g, '\n');
                let boundaryIndex;
                
                while ((boundaryIndex = streamBuffer.indexOf('\n\n')) !== -1) {
                    const completeEvent = streamBuffer.slice(0, boundaryIndex).trim();
                    streamBuffer = streamBuffer.slice(boundaryIndex + 2);
                    
                    if (!completeEvent) continue;
                    if (completeEvent.startsWith('data: ')) {
                        const dataStr = completeEvent.slice(6).trim();
                        if (dataStr === '[DONE]') continue;
                        
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.error) {
                                console.error("[OpenRouter Stream Error]:", data.error);
                                res.write(`data: ${JSON.stringify({ error: typeof data.error === 'string' ? data.error : (data.error.message || "Lỗi API AI") })}\n\n`);
                                res.write('data: [DONE]\n\n');
                                res.end();
                                return; // Thoát hẳn để kết thúc stream
                            }
                            
                            if (data.choices && data.choices.length > 0) {
                                const choice = data.choices[0];
                                const chunkText = choice.delta?.content || "";
                                if (chunkText) {
                                    fullAiReply += chunkText;
                                    res.write(`data: ${JSON.stringify({ content: chunkText })}\n\n`);
                                }

                                // [FIX VẤN ĐỀ 3 - NGUYÊN NHÂN 3] Bắt finish_reason để thông báo
                                // rõ ràng ra Frontend thay vì im lặng cắt stream giữa chừng
                                const finishReason = choice.finish_reason;
                                if (finishReason && finishReason !== 'stop' && finishReason !== 'end_turn') {
                                    let warningMsg = '';
                                    if (finishReason === 'length') {
                                        warningMsg = '\n\n⚠️ *(Phản hồi bị giới hạn độ dài. Bạn có thể hỏi tiếp để AI trình bày thêm.)*';
                                    } else if (finishReason === 'content_filter' || finishReason === 'safety') {
                                        warningMsg = '\n\n⚠️ *(Phần nội dung này bị bộ lọc an toàn của mô hình kiểm duyệt. Vui lòng thử diễn đạt lại câu hỏi.)*';
                                    }
                                    if (warningMsg) {
                                        fullAiReply += warningMsg;
                                        res.write(`data: ${JSON.stringify({ content: warningMsg })}\n\n`);
                                    }
                                    console.warn(`[AI Stream] finish_reason: ${finishReason} — Model dừng sớm.`);
                                }
                            }
                        } catch (e) {
                            if (e.message !== "Unexpected end of JSON input" && !e.message.includes("Unexpected token")) {
                                console.error("[Chunk Processing Error]:", e.message, "Data:", dataStr);
                            }
                        }
                    }
                }
            }
        }
        
        if (!req.aborted && !res.writableEnded) {
            res.write('data: [DONE]\n\n');
            res.end();
        }
        
        await saveAiReplyToDb();

    } catch (error) {
        console.error('[AI Controller Error]:', error.message);
        if (!req.aborted && !res.writableEnded) {
            if (!res.headersSent) {
                res.status(500);
            }
            res.write(`data: ${JSON.stringify({ error: "Sự cố API LLM. " + error.message, status: 500 })}\n\n`);
            res.write('data: [DONE_WITH_ERROR]\n\n');
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

// [MỚI] AUTO-TASKING HANDLER ĐÃ ĐƯỢC TỐI ƯU HÓA THEO CHỈ THỊ HUBDB 555
const autoTaskingHandler = async (req, res) => {
  try {
    const { meetingTranscript, facilityId } = req.body;

    if (!meetingTranscript) {
      return res.status(400).json({ error: 'Vui lòng cung cấp biên bản cuộc họp.' });
    }

    // [CẬP NHẬT] Tinh chỉnh System Prompt thép
    const systemPrompt = `Bạn là một AI điều phối Công việc xuất sắc. Nhiệm vụ: Đọc biên bản cuộc họp và tự động trích xuất các công việc cần làm thành định dạng JSON strict.
Trích xuất mảng "tasks" với cấu trúc: "task_title", "pic", "deadline" (YYYY-MM-DDTHH:mm, mặc định 17:00 nếu không có giờ), "target_facility" (Tên cơ sở, ví dụ: Cơ sở 1), "priority_level" (Quét văn bản: Nếu có 'khẩn cấp', 'gấp', 'ngay', 'hỏa tốc' -> 'URGENT'. Nếu không -> 'PRIORITY'). \nLƯU Ý TỐI QUAN TRỌNG: Đối với trường 'pic' (Người phụ trách), CHỈ bóc tách tên khi có danh tính rõ ràng. Tuyệt đối cấm bóc chức danh (như 'kỹ thuật', 'lễ tân'). Nếu không rõ tên, trả về pic: "". Tuyệt đối không được tự bịa ra tên người hoặc dùng lại tên cơ sở.`;

    const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
    const aiConfig = configRows.length > 0 ? configRows[0].data : {};
    const aiModel = aiConfig.model || "google/gemini-2.5-flash";
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModel,
        messages: [ { role: "system", content: systemPrompt }, { role: "user", content: meetingTranscript } ],
        response_format: { type: "json_object" }
      })
    });

    const aiData = await response.json();
    let extractedTasks = [];

    if (aiData.choices && aiData.choices.length > 0) {
      try {
        extractedTasks = JSON.parse(aiData.choices[0].message.content);
        if (extractedTasks.tasks) extractedTasks = extractedTasks.tasks;
        
        if (Array.isArray(extractedTasks)) {
            
            // [MỚI] BỘ NHỚ ĐỆM (CACHING) TOÀN BỘ NHÂN SỰ ĐỂ HỖ TRỢ ĐIỀU PHỐI LIÊN CƠ SỞ (SUPER ADMIN)
            let cachedUsers = [];
            try {
                const { rows: usersRows } = await pool.query(
                    'SELECT id, full_name, role_id, facility_id FROM users'
                );
                cachedUsers = usersRows;
            } catch (cacheErr) {
                console.error("Lỗi khi load cache Users:", cacheErr.message);
            }

            for (let t of extractedTasks) {
               // Xử lý cơ sở
               let mappedFacilityId = parseSafeFacilityId(facilityId) || parseSafeFacilityId(req.user.facility_id);
               if (t.target_facility) {
                   const { rows } = await pool.query('SELECT id FROM facilities WHERE name ILIKE $1 LIMIT 1', [`%${t.target_facility}%`]);
                   if (rows.length > 0) {
                       mappedFacilityId = rows[0].id;
                   }
               }
               
               // Fallback lại để tương thích Frontend nếu không parse được
               t.facility_id = mappedFacilityId || facilityId; 
               t.priority_level = t.priority_level === 'URGENT' ? 'URGENT' : 'PRIORITY';
               t.created_by_role = req.user.role;

               // --- [MỚI] THUẬT TOÁN ĐIỀU PHỐI PIC LIÊN CƠ SỞ ---
               let finalPicId = null;
               let finalPicName = "";

               // Lọc nhân sự theo cơ sở đích (nếu xác định được)
               const facilityUsers = mappedFacilityId 
                   ? cachedUsers.filter(u => u.facility_id == mappedFacilityId)
                   : cachedUsers;

               // Khớp tên từ AI
               if (t.pic && typeof t.pic === 'string' && t.pic.trim() !== '') {
                   const normalizedInput = normalizeName(t.pic);
                   
                   // Lọc tất cả nhân sự khớp tên trong cơ sở đích
                   const matchedUsers = facilityUsers.filter(u => 
                       normalizeName(u.full_name).includes(normalizedInput)
                   );

                   // Chỉ gán khi tìm thấy ĐÚNG 1 người
                   if (matchedUsers.length === 1) {
                       finalPicId = matchedUsers[0].id;
                       finalPicName = matchedUsers[0].full_name;
                   } else if (matchedUsers.length === 0 && mappedFacilityId) {
                       // Mở rộng tìm kiếm toàn hệ thống nếu cơ sở đích không có (trường hợp Sếp gán việc chéo)
                       const globalMatched = cachedUsers.filter(u => 
                           normalizeName(u.full_name).includes(normalizedInput)
                       );
                       if (globalMatched.length === 1) {
                           finalPicId = globalMatched[0].id;
                           finalPicName = globalMatched[0].full_name;
                       }
                   } else if (matchedUsers.length > 1 && mappedFacilityId) {
                       // Thêm logic: Nếu có nhiều người trùng tên trong cơ sở, ưu tiên người không phải quản lý nếu có, nhưng an toàn nhất là null
                       // Tạm thời để null nếu không xác định được đích xác
                   }
               }

               // FALLBACK (Nếu AI không mò ra tên, hoặc Khớp tên thất bại)
               if (finalPicId === null) {
                   // Tìm Quản lý cơ sở (role_id = 6) trong danh sách nhân sự khả dụng
                   const facilityManager = facilityUsers.find(u => u.role_id === 6);
                   
                   if (facilityManager) {
                       finalPicId = facilityManager.id;
                       finalPicName = facilityManager.full_name;
                   } else {
                       console.warn(`[Auto-Tasking] Cảnh báo: Không có Facility Manager (role_id=6)`);
                       finalPicId = null; 
                       finalPicName = t.pic || ""; // Giữ nguyên tên gốc hoặc để trống
                   }
               }

               // Gán ngược dữ liệu đã chuẩn hóa vào task
               t.pic_id = finalPicId;
               t.pic = finalPicName;
               // --------------------------------------------------
            }
        }
      } catch (e) {
        console.error("AI không trả về JSON hợp lệ:", e.message);
      }
    }

    res.json({ success: true, message: 'Trích xuất Auto-Tasking thành công.', data: extractedTasks });

  } catch (error) {
    console.error('[AI Controller Error]:', error.message);
    res.status(500).json({ error: 'Lỗi khi gọi AI API.' });
  }
};

module.exports = {
    chatStreamHandler,
    getSessionsHandler,
    createSessionHandler,
    pingBatchHandler,
    getMessagesHandler,
    testKeyHandler,
    getAuditLogsHandler,
    autoTaskingHandler,
    // [FIX VẤN ĐỀ 4] Hàm xóa cache — gọi từ configRoutes khi admin lưu config mới
    invalidateAIConfigCache: () => {
        _aiConfigCache = null;
        _lastCacheTime = 0;
        console.log('[getAIConfig] Cache đã bị xóa — model mới sẽ được tải từ DB ở request tiếp theo.');
    }
};
