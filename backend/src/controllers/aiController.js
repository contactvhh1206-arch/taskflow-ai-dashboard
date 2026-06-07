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
                let targetMonth = null;
                const monthMatch = lowerMsg.match(/tháng\s*(\d{1,2})/);
                if (monthMatch) targetMonth = parseInt(monthMatch[1], 10);
                
                const revSummary = await aiService.processToolCall('fetch_revenue_summary', { month: targetMonth }, userContext);
                if (!revSummary.includes('Không có dữ liệu')) {
                    dbContextStr += "\n\n[DỮ LIỆU TỔNG DOANH THU CHUẨN (TỪ DASHBOARD)]:\n" + revSummary;
                }

                const revDetails = await aiService.processToolCall('fetch_financial_reports', { limit: 1000 }, userContext);
                if (!revDetails.includes('Không có dữ liệu')) {
                    dbContextStr += "\n\n[CHI TIẾT DOANH THU THEO TỪNG NGÀY]:\n" + revDetails;
                }
            }
            
            if (lowerMsg.includes('công việc') || lowerMsg.includes('task') || lowerMsg.includes('tiến độ') || lowerMsg.includes('chưa làm')) {
                const taskData = await aiService.processToolCall('fetch_kanban_tasks', { limit: 1000 }, userContext);
                if (!taskData.includes('Không có công việc nào')) {
                    dbContextStr += "\n\n[DỮ LIỆU CÔNG VIỆC HIỆN TẠI]:\n" + taskData;
                }
            }
        } catch (e) {
            console.error("Lỗi chèn RAG tự động:", e.message);
        }

        // 4. Tạo System Prompt có RAG
        const systemPrompt = `Bạn là AI Agent của TaskFlow. Người dùng có Role: ${userContext.role}, ID Cơ sở: ${safeFacilityId || 'N/A'}.${dbContextStr ? '\n\nSau đây là dữ liệu hệ thống tự động trích xuất theo ngữ cảnh câu hỏi của người dùng (Hãy dựa vào đây để trả lời chính xác, KHÔNG YÊU CẦU USER CUNG CẤP THÊM FILE nếu dữ liệu đã đủ):' + dbContextStr : ''}
Hãy hỗ trợ người dùng phân tích thông tin và trả lời câu hỏi một cách tự nhiên, chuyên nghiệp. Tuyệt đối tuân thủ phân quyền và RAG context.`;

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
        if (messages.length === 1 || !messages[messages.length - 1].content.includes(message)) {
            if (messages[messages.length - 1].role === 'user') {
                messages[messages.length - 1].content += "\n\n" + message;
            } else {
                messages.push({ role: 'user', content: message });
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

        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const aiModel = req.body.model || process.env.DEFAULT_AI_MODEL || "google/gemini-3.1-pro-preview";

        const llmPayload = {
            model: aiModel,
            messages: messages,
            stream: true,
            max_tokens: 2000
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
                                const chunkText = data.choices[0].delta?.content || "";
                                if (chunkText) {
                                    fullAiReply += chunkText;
                                    res.write(`data: ${JSON.stringify({ content: chunkText })}\n\n`);
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
            
            // [MỚI] BỘ NHỚ ĐỆM (CACHING) TRƯỚC VÒNG LẶP: Truy xuất toàn bộ nhân sự của Cơ sở gốc
            let cachedUsers = [];
            const targetCacheFacility = parseSafeFacilityId(facilityId) || parseSafeFacilityId(req.user.facility_id);
            
            if (targetCacheFacility !== null) {
                try {
                    const { rows: usersRows } = await pool.query(
                        'SELECT id, full_name, role_id FROM users WHERE facility_id = $1',
                        [targetCacheFacility]
                    );
                    cachedUsers = usersRows;
                } catch (cacheErr) {
                    console.error("Lỗi khi load cache Users:", cacheErr.message);
                }
            }

            for (let t of extractedTasks) {
               // Xử lý cơ sở
               let mappedFacilityId = facilityId;
               if (t.target_facility) {
                   const { rows } = await pool.query('SELECT id FROM facilities WHERE name ILIKE $1 LIMIT 1', [`%${t.target_facility}%`]);
                   if (rows.length > 0) {
                       mappedFacilityId = rows[0].id;
                   }
               }
               t.facility_id = mappedFacilityId;
               t.priority_level = t.priority_level === 'URGENT' ? 'URGENT' : 'PRIORITY';
               t.created_by_role = req.user.role;

               // --- [MỚI] THUẬT TOÁN ĐIỀU PHỐI PIC CÓ CACHING ---
               let finalPicId = null;
               let finalPicName = "";

               // Khớp tên từ AI
               if (t.pic && typeof t.pic === 'string' && t.pic.trim() !== '') {
                   const normalizedInput = normalizeName(t.pic);
                   
                   // Lọc tất cả nhân sự khớp tên
                   const matchedUsers = cachedUsers.filter(u => 
                       normalizeName(u.full_name).includes(normalizedInput)
                   );

                   // Chỉ gán khi tìm thấy ĐÚNG 1 người (Đảm bảo độ chính xác tuyệt đối)
                   if (matchedUsers.length === 1) {
                       finalPicId = matchedUsers[0].id;
                       finalPicName = matchedUsers[0].full_name;
                   }
               }

               // FALLBACK (Nếu AI không mò ra tên, hoặc Khớp tên thất bại)
               if (finalPicId === null) {
                   // Tìm thẳng Quản lý cơ sở (role_id = 6) trong bộ nhớ đệm
                   const facilityManager = cachedUsers.find(u => u.role_id === 6);
                   
                   if (facilityManager) {
                       finalPicId = facilityManager.id;
                       finalPicName = facilityManager.full_name;
                   } else {
                       // Tối ưu chống crash: Cơ sở chưa có Quản lý
                       console.warn(`[Auto-Tasking] Cảnh báo: Cơ sở ${mappedFacilityId} không có Facility Manager (role_id=6)`);
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
    autoTaskingHandler
};
