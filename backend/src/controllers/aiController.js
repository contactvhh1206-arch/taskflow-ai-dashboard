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

    // PROMPT HOÀNG KIM f4605ca
    const systemPrompt = `Bạn là AI Agent của TaskFlow. Người dùng có Role: ${userContext.role}, ID Cơ sở: ${safeFacilityId || 'N/A'}.
Hãy hỗ trợ người dùng phân tích thông tin và trả lời câu hỏi một cách tự nhiên, chuyên nghiệp. Tuyệt đối tuân thủ phân quyền và RAG context.`;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', 
        'Access-Control-Allow-Origin': '*'
    });
    res.flushHeaders();

    let isClientConnected = true;
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
        isClientConnected = false;
        saveAiReplyToDb();
        res.end();
    });

    try {
        await pool.query(`
            INSERT INTO ai_chat_messages (session_id, facility_id, department_code, role, content)
            VALUES ($1, $2, $3, 'user', $4)
        `, [sessionId, logFacilityId, logDepartmentCode, message]);

        await pool.query(
            'UPDATE ai_chat_sessions SET timestamp = $1 WHERE id = $2',
            [Date.now(), sessionId]
        );

        if (isNewSession && isClientConnected) {
            res.write(`data: ${JSON.stringify({ sessionId: sessionId })}\n\n`);
        }

        const { rows: historyRows } = await pool.query(`
            SELECT m.role, m.content
            FROM ai_chat_messages m
            INNER JOIN ai_chat_sessions s ON m.session_id = s.id
            WHERE m.session_id = $1 AND s.user_id = $2
            ORDER BY m.created_at DESC
            LIMIT 20
        `, [sessionId, userContext.id]);
        
        historyRows.reverse();

        const messages = [ { role: "system", content: systemPrompt } ];

        for (const msg of historyRows) {
            if (msg.role === 'assistant' || msg.role === 'user') {
                if (msg.content && msg.content.trim() !== "") {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }
        
        if (messages.length === 1 || messages[messages.length - 1].content !== message) {
            messages.push({ role: 'user', content: message });
        }

        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const aiModel = req.body.model || process.env.DEFAULT_AI_MODEL || "openai/gpt-3.5-turbo";

        const llmPayload = {
            model: aiModel,
            messages: messages,
            stream: true,
            max_tokens: 2000
        };

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json",
                'HTTP-Referer': process.env.SITE_URL || 'https://hubdb.app',
                'X-Title': process.env.SITE_NAME || 'HUBDB'
            },
            body: JSON.stringify(llmPayload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API LLM lỗi ${response.status}: ${errText}`);
        }

        if (isClientConnected) {
            const reader = response.body;
            let streamBuffer = ""; 
            const decoder = new TextDecoder("utf-8");
            
            for await (const chunkBuffer of reader) {
                if (!isClientConnected) break;
                
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
        
        if (isClientConnected) {
            res.write('data: [DONE]\n\n');
            res.end();
        }
        
        await saveAiReplyToDb();

    } catch (error) {
        console.error('[AI Controller Error]:', error.message);
        if (isClientConnected) {
            if (!res.headersSent) res.status(500);
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

module.exports = {
    chatStreamHandler,
    getSessionsHandler,
    createSessionHandler,
    pingBatchHandler,
    getMessagesHandler,
    testKeyHandler,
    getAuditLogsHandler
};
