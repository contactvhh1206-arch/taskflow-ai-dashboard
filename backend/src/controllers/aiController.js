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
                // [FIX] Bước 1: Xác định TẤT CẢ các tháng người dùng nhắc tới (hỗ trợ câu hỏi so sánh)
                const now = new Date();
                const currentMonth = now.getMonth() + 1; // 1-12
                const currentYear = now.getFullYear();

                // Năm dự phòng cho các tháng không ghi năm kèm theo:
                // nếu câu hỏi chỉ nhắc đúng 1 năm (VD "tháng 6 và tháng 7 năm 2025") thì dùng năm đó.
                const yearsInMsg = [...new Set((lowerMsg.match(/\b20\d{2}\b/g) || []).map(Number))];
                const fallbackYear = yearsInMsg.length === 1 ? yearsInMsg[0] : currentYear;

                const targets = [];
                const seenTargets = new Set();
                const pushTarget = (m, y) => {
                    if (!(m >= 1 && m <= 12)) return;
                    const key = `${y}-${m}`;
                    if (seenTargets.has(key)) return;
                    seenTargets.add(key);
                    targets.push({ month: m, year: y });
                };

                // Ưu tiên 1: Trích xuất MỌI mốc "tháng N" kèm năm nếu có (VD "tháng 6/2026", "tháng 12 - 2025").
                // Dùng matchAll (cờ /g) thay cho match() — match() không cờ chỉ trả về kết quả ĐẦU TIÊN,
                // khiến câu hỏi "so sánh tháng 6 và tháng 7" chỉ nạp dữ liệu tháng 6.
                for (const mt of lowerMsg.matchAll(/th[áa]ng\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{4}))?/g)) {
                    pushTarget(parseInt(mt[1], 10), mt[2] ? parseInt(mt[2], 10) : fallbackYear);
                }

                // Ưu tiên 2: Nhận diện từ khóa mang nghĩa "tháng này" -> gán tháng hiện tại
                const isCurrentMonthKeyword = lowerMsg.includes('tháng này') || lowerMsg.includes('tháng hiện tại') || lowerMsg.includes('trong tháng') || lowerMsg.includes('tháng hiện hành') || lowerMsg.includes('tháng nay');
                if (targets.length === 0 && isCurrentMonthKeyword) {
                    pushTarget(currentMonth, currentYear);
                }

                // Ưu tiên 3: Không có từ khóa thời gian nào -> mặc định về tháng hiện tại
                if (targets.length === 0) {
                    pushTarget(currentMonth, currentYear);
                }

                // Chặn trần: tránh một câu hỏi kéo hàng chục tháng làm phình context và quá tải DB
                const MAX_REVENUE_MONTHS = 4;
                let truncatedNote = '';
                if (targets.length > MAX_REVENUE_MONTHS) {
                    truncatedNote = `\n\n[LƯU Ý] Câu hỏi nhắc tới ${targets.length} tháng, hệ thống chỉ nạp dữ liệu ${MAX_REVENUE_MONTHS} tháng đầu tiên.`;
                    targets.length = MAX_REVENUE_MONTHS;
                }

                // [FIX] Bước 2: Tự ghép chuỗi YYYY-MM-DD theo giờ địa phương.
                // Không dùng toISOString() vì nó quy đổi sang UTC, làm lệch 1 ngày khi server chạy ở múi giờ dương.
                const fmt = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const isMultiMonth = targets.length > 1;

                // [FIX] Bước 3: Nạp dữ liệu cho từng tháng, gắn nhãn rõ ràng để AI không lẫn số liệu giữa các tháng
                for (const t of targets) {
                    const label = `THÁNG ${t.month}/${t.year}`;
                    const targetStartDate = fmt(t.year, t.month, 1);
                    const targetEndDate = fmt(t.year, t.month, new Date(t.year, t.month, 0).getDate());

                    const revSummary = await aiService.processToolCall('fetch_revenue_summary', { month: t.month, year: t.year }, userContext);
                    if (!revSummary.toLowerCase().includes('không có dữ liệu')) {
                        dbContextStr += `\n\n[DỮ LIỆU TỔNG DOANH THU CHUẨN (TỪ DASHBOARD) — ${label}]:\n` + revSummary;
                    } else if (isMultiMonth) {
                        // Khi so sánh nhiều tháng, phải nói rõ tháng nào trống thay vì bỏ qua im lặng,
                        // tránh việc AI tưởng tháng đó không tồn tại trong hệ thống.
                        dbContextStr += `\n\n[DỮ LIỆU TỔNG DOANH THU CHUẨN (TỪ DASHBOARD) — ${label}]:\nHệ thống không có dữ liệu doanh thu cho ${label}.`;
                    }

                    // Truyền đúng mốc thời gian vào fetch_financial_reports,
                    // tránh để trống khiến aiService quét toàn bộ DB rồi cộng dồn sai tháng
                    const revDetails = await aiService.processToolCall('fetch_financial_reports', { start_date: targetStartDate, end_date: targetEndDate, limit: 500 }, userContext);
                    if (!revDetails.toLowerCase().includes('không có dữ liệu')) {
                        dbContextStr += `\n\n[CHI TIẾT DOANH THU THEO TỪNG NGÀY — ${label}]:\n` + revDetails;
                    }
                }
                dbContextStr += truncatedNote;
            }
            
            // [FIX VẤN ĐỀ 2] Mở rộng từ khóa kích hoạt để bao gồm cả nhật ký vận hành
            const hasTaskKeyword = lowerMsg.includes('công việc') || lowerMsg.includes('task') || lowerMsg.includes('tiến độ') || lowerMsg.includes('chưa làm');
            const hasOpsKeyword = lowerMsg.includes('nhật ký') || lowerMsg.includes('vận hành') || lowerMsg.includes('chuyên cần') || lowerMsg.includes('ca làm') || lowerMsg.includes('thiết bị') || lowerMsg.includes('sự cố') || lowerMsg.includes('vệ sinh') || lowerMsg.includes('ktv') || lowerMsg.includes('lễ tân') || lowerMsg.includes('chấm công') || lowerMsg.includes('tổng quan') || lowerMsg.includes('nhân sự') || lowerMsg.includes('check in') || lowerMsg.includes('checkin') || lowerMsg.includes('báo cáo ca') || lowerMsg.includes('trực ca') || lowerMsg.includes('đi làm') || lowerMsg.includes('danh sách') || lowerMsg.includes('ai nghỉ') || lowerMsg.includes('nghỉ phép') || lowerMsg.includes('nghỉ không phép') || lowerMsg.includes('có mặt') || lowerMsg.includes('vắng mặt') || lowerMsg.includes('điểm danh') || lowerMsg.includes('nhân viên') || lowerMsg.includes('bảo vệ') || lowerMsg.includes('lao công') || lowerMsg.includes('ca sáng') || lowerMsg.includes('ca tối') || lowerMsg.includes('ca 1') || lowerMsg.includes('ca 2');
            if (hasTaskKeyword) {
                const taskData = await aiService.processToolCall('fetch_kanban_tasks', { limit: 500 }, userContext);
                if (!taskData.includes('Không có công việc nào')) {
                    dbContextStr += "\n\n[DỮ LIỆU CÔNG VIỆC KANBAN]:\n" + taskData;
                }
            }
            if (hasOpsKeyword) {
                // Xác định khoảng ngày truy vấn: ưu tiên ngày người dùng đề cập, mặc định 7 ngày gần nhất
                // Định dạng DD/MM/YYYY cho khớp cột date của bảng daily_logs
                const now = new Date();
                const fmtDate = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
                let opsStartDate = fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
                let opsEndDate = fmtDate(now);

                // Trích xuất ngày cụ thể nếu người dùng đề cập (VD: "ngày 19/06", "24/06", "24/06/2026"...)
                const dateMatch = lowerMsg.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
                if (dateMatch) {
                    const d = parseInt(dateMatch[1]);
                    const m = parseInt(dateMatch[2]);
                    const y = dateMatch[3] ? (dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3])) : now.getFullYear();
                    const specificDate = new Date(y, m - 1, d);
                    opsStartDate = fmtDate(specificDate);
                    opsEndDate = fmtDate(specificDate);
                } else if (lowerMsg.includes('hôm nay') || lowerMsg.includes('hom nay')) {
                    opsStartDate = fmtDate(now);
                    opsEndDate = fmtDate(now);
                } else if (lowerMsg.includes('hôm qua') || lowerMsg.includes('hom qua')) {
                    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
                    opsStartDate = fmtDate(yesterday);
                    opsEndDate = fmtDate(yesterday);
                } else if (lowerMsg.includes('3 ngày') || lowerMsg.includes('ba ngày')) {
                    opsStartDate = fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3));
                }

                const dailyLogsData = await aiService.processToolCall('fetch_daily_logs', { start_date: opsStartDate, end_date: opsEndDate }, userContext);
                if (dailyLogsData && !dailyLogsData.includes('Không có dữ liệu')) {
                    dbContextStr += "\n\n[NHẬT KÝ VẬN HÀNH & BÁO CÁO CA LÀM VIỆC THỰC TẾ]:\n" + dailyLogsData;
                }
            }

            // [KPI] Kích hoạt phân tích KPI khi có từ khóa liên quan
            const hasKpiKeyword = lowerMsg.includes('kpi') || lowerMsg.includes('chỉ tiêu') || lowerMsg.includes('chi tieu') ||
                lowerMsg.includes('mục tiêu') || lowerMsg.includes('muc tieu') || lowerMsg.includes('hiệu suất') ||
                lowerMsg.includes('hieu suat') || lowerMsg.includes('phương án kinh doanh') || lowerMsg.includes('phuong an') ||
                lowerMsg.includes('đạt chỉ tiêu') || lowerMsg.includes('đạt kpi') || lowerMsg.includes('dat kpi') ||
                lowerMsg.includes('tư vấn doanh thu') || lowerMsg.includes('target') || lowerMsg.includes('đánh giá cơ sở') ||
                lowerMsg.includes('cơ sở nào tốt') || lowerMsg.includes('cơ sở nào yếu') || lowerMsg.includes('so sánh cơ sở') ||
                lowerMsg.includes('cải thiện doanh thu') || lowerMsg.includes('giải pháp doanh thu') || lowerMsg.includes('chiến lược');
            if (hasKpiKeyword) {
                // Trích xuất tháng/năm từ câu hỏi nếu có (tái dụng logic từ block revenue)
                const now = new Date();
                let kpiMonth = now.getMonth() + 1;
                let kpiYear = now.getFullYear();
                const kpiMonthMatch = lowerMsg.match(/tháng\s*(\d{1,2})/);
                if (kpiMonthMatch) kpiMonth = parseInt(kpiMonthMatch[1]);
                const kpiYearMatch = lowerMsg.match(/\b(202\d)\b/);
                if (kpiYearMatch) kpiYear = parseInt(kpiYearMatch[1]);

                const kpiAnalysisData = await aiService.processToolCall('fetch_kpi_analysis', { month: kpiMonth, year: kpiYear }, userContext);
                if (kpiAnalysisData && !kpiAnalysisData.includes('gặp lỗi') && !kpiAnalysisData.includes('Chưa có cấu hình')) {
                    dbContextStr += "\n\n[PHÂN TÍCH KPI & HIỆU SUẤT CƠ SỞ]:\n" + kpiAnalysisData;
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

            // [MỚI] TRUY VẤN TRÍ NHỚ DÀI HẠN (LEARNED INSIGHTS)
            // AI tìm kiếm bài học liên quan từ các cuộc hội thoại trước của mọi người dùng
            const learnedInsights = await ragService.searchLearnedInsights(message, userContext, 5);
            if (learnedInsights && learnedInsights.length > 0) {
                const insightTexts = learnedInsights.map(i =>
                    `[${(i.category || 'operations').toUpperCase()}] ${i.insight_text}`
                );
                dbContextStr += "\n\n[KINH NGHIỆM & BÀI HỌC TỪ CÁC PHIÊN TRƯỚC]:\n" + insightTexts.join('\n---\n');
            }
        } catch (e) {
            console.error("Lỗi chèn RAG tự động:", e.message);
        }

        // 4. Tạo System Prompt có RAG
        const currentTimeString = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        // [V2 - SMART ADVISOR PROMPT] Cố vấn AI thông minh: biết đọc ý người hỏi,
        // liệt kê chi tiết khi cần, tóm tắt khi phù hợp, luôn gợi mở câu hỏi tiếp theo.
        const systemPrompt = `Bạn là Cố vấn AI Cấp cao của hệ thống quản lý chuỗi cơ sở Hub Dubai. Thời gian hiện tại: ${currentTimeString}. Role người dùng: ${userContext.role}, Cơ sở: ${safeFacilityId || 'Tất cả'}.

## TÍNH CÁCH & PHONG CÁCH
Bạn là một cố vấn vận hành dày dạn kinh nghiệm — nói chuyện thẳng thắn, sắc sảo và thực chiến như một COO thực thụ. Bạn hiểu tầm quan trọng của việc đủ người trực ca, ai nghỉ không phép là rủi ro, doanh thu thấp ngày nào cần truy nguyên nhân.

## NGUYÊN TẮC CỐT LÕI

### 1. HIỂU Ý TRƯỚC KHI TRẢ LỜI
- Khi sếp hỏi "danh sách nhân viên đi làm", "ai trực", "nhân sự hôm nay" → PHẢI liệt kê CHI TIẾT tên từng người, ca nào, vị trí nào (lễ tân, bảo vệ, KTV...). Tuyệt đối không tóm tắt thành con số chung chung.
- Khi sếp hỏi "ai nghỉ", "nghỉ phép" → PHẢI nêu rõ: nghỉ có phép (CP) gồm những ai, nghỉ không phép (KP) gồm những ai, lý do nếu có.
- Khi sếp hỏi "tổng quan", "tình hình chung", "nhận xét" → Lúc này mới tổng hợp con số + nhận định quản trị.
- Khi sếp hỏi "doanh thu" → Báo con số cụ thể từng cơ sở, có so sánh xu hướng.
- Khi không chắc sếp muốn chi tiết hay tổng quan → MẶC ĐỊNH trả chi tiết. Thiếu thông tin nguy hiểm hơn thừa thông tin.

### 2. TRÌNH BÀY THEO MỨC ĐỘ
- **Câu hỏi yêu cầu danh sách/chi tiết**: Liệt kê ĐẦY ĐỦ dữ liệu có trong hệ thống, tổ chức rõ ràng theo nhóm (theo ca, theo vị trí, theo cơ sở). Sau đó mới thêm 1 nhận định ngắn nếu phát hiện bất thường.
- **Câu hỏi mang tính tổng quan/đánh giá**: Tóm tắt con số chính + nêu 1-2 nhận định sắc bén về điểm nghẽn hoặc rủi ro + 1 đề xuất hành động cụ thể.

### 3. GIỌNG VĂN CỐ VẤN
- Mở đầu đi thẳng vào vấn đề, không chào hỏi, không rào đón.
- Dùng ngôn ngữ chuyên nghiệp, đanh thép khi cần cảnh báo.
- Khi phát hiện bất thường (nghỉ không phép nhiều, doanh thu sụt đột ngột, thiết bị hỏng...) → Chủ động cảnh báo dù sếp không hỏi.
- Nếu dữ liệu thiếu → Nói rõ: "Chưa có dữ liệu báo cáo cho [X], cần kiểm tra lại với quản lý cơ sở."

### 4. LUÔN GỢI MỞ CÂU HỎI TIẾP THEO
Sau mỗi câu trả lời, LUÔN kết thúc bằng phần gợi ý câu hỏi tiếp theo với format:

📌 **Sếp có thể hỏi thêm:**
- [Gợi ý 1 liên quan trực tiếp đến nội dung vừa trả lời]
- [Gợi ý 2 mở rộng sang khía cạnh liên quan (doanh thu, thiết bị, công việc...)]
- [Gợi ý 3 đào sâu vào điểm bất thường nếu có, hoặc góc nhìn so sánh]

### 5. TRUNG THỰC TUYỆT ĐỐI
- Chỉ dùng dữ liệu có trong phần [DỮ LIỆU HỆ THỐNG] bên dưới. Không bịa số liệu, không suy đoán.
- Nếu thiếu dữ liệu → Nói rõ thiếu gì, đề xuất ai cần bổ sung.

### 6. ĐỊNH DẠNG
- Dùng **in đậm** cho tên người, con số, chỉ số quan trọng.
- Dùng gạch đầu dòng (-) để liệt kê.
- Dùng bảng markdown khi so sánh nhiều cơ sở hoặc nhiều ngày.
- Tách rõ các khối thông tin bằng heading (###).

### 7. SỬ DỤNG KINH NGHIỆM ĐÃ HỌC (TRÍ NHỚ DÀI HẠN)
Nếu có phần [KINH NGHIỆM & BÀI HỌC TỪ CÁC PHIÊN TRƯỚC] ở dữ liệu hệ thống:
- **Coi đây là tri thức nền của tổ chức**, tích lũy từ các cuộc hội thoại quản trị thực tế.
- **Bài học [DIRECTIVE]**: Là chỉ thị trực tiếp từ Ban lãnh đạo — PHẢI tuân thủ tuyệt đối, ưu tiên cao nhất.
- **Bài học [OPERATIONS/REVENUE/INCIDENT]**: Tham chiếu khi đưa ra đề xuất: "Dựa trên kinh nghiệm xử lý tương tự trước đó..."
- **Bài học [PREFERENCE]**: Áp dụng phong cách trình bày phù hợp sở thích của sếp.
- KHÔNG tự bịa thêm kinh nghiệm không có trong dữ liệu.

## HƯỚNG DẪN ĐỌC DỮ LIỆU NHẬT KÝ VẬN HÀNH
Dữ liệu nhật ký có 2 loại:
- **Operation_Log**: Ghi chép tự do của quản lý — gồm danh sách nhân viên trực ca (tên lễ tân, bảo vệ, KTV...), số hiệu KTV theo từng khung giờ, ghi chú vận hành trong ngày.
- **Attendance (Báo cáo ca)**: Ghi nhận cuối ca — số người nghỉ có phép (CP), nghỉ không phép (KP), tình trạng thiết bị, vệ sinh.

Khi sếp hỏi nhân viên đi làm hoặc danh sách nhân sự:
→ Trích xuất TẤT CẢ tên người từ Operation_Log (Sáng/Tối/Ca...) VÀ số liệu nghỉ từ Attendance.
→ Tổ chức lại thành danh sách rõ ràng theo vị trí và ca làm.

## HƯỚNG DẪN PHÂN TÍCH KPI VÀ ĐỀ XUẤT PHƯƠNG ÁN KINH DOANH
Khi có dữ liệu [PHÂN TÍCH KPI & HIỆU SUẤT CƠ SỞ]:
- **TUYỆT ĐỐI không chỉ đọc lại số liệu**. Phải phân tích, nhận định và đề xuất hành động cụ thể.
- So sánh doanh thu thực tế vs chỉ tiêu → nhận xét xu hướng, cảnh báo rủi ro.
- **Nếu cơ sở đang ĐỎ (dưới chỉ tiêu nguy hiểm)**: Đề xuất ngay tối thiểu 3 phương án: tăng ca giờ cao điểm, chạy flash deal / combo khuyến mãi ngắn hạn, điều nhân sự từ cơ sở đang dư sang, rà soát lý do vắng khách (thiết bị, vệ sinh, nhân sự...).
- **Nếu cơ sở đang VÀNG (cần cố gắng)**: Đề xuất 2-3 phương án thúc đẩy nhẹ: tối ưu khung giờ cao điểm, upsell dịch vụ, tăng cường chăm sóc khách cũ.
- **Nếu cơ sở đang XANH hoặc vượt KPI**: Khen và phân tích yếu tố đang hoạt động tốt, cảnh báo nếu tốc độ đang có xu hướng giảm.
- **Khi có nhiều cơ sở**: So sánh tổng thể, xếp hạng hiệu suất, chỉ ra cơ sở cần ưu tiên hỗ trợ nhất.
- **Dự báo cuối tháng**: Dựa vào tốc độ TB hiện tại và ngày còn lại để tính dự báo doanh thu cuối tháng.
- Kết thúc bằng **1 hành động cần làm ngay trong 24h** cho từng cơ sở đang cần cải thiện.
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

    // [v2] System Prompt hỗ trợ description + tách task nhiều cơ sở + PIC mã cơ sở
    const systemPrompt = `Bạn là AI điều phối Công việc của hệ thống Hub Dubai. Nhiệm vụ: Đọc biên bản/chỉ thị và trích xuất thành JSON strict.

TRẢ VỀ: Mảng "tasks", mỗi phần tử gồm:
- "task_title": Tiêu đề ngắn gọn.
- "description": Toàn bộ nội dung chi tiết, số liệu, ghi chú (giữ nguyên văn, KHÔNG để trống nếu có thông tin — đây là trường QUAN TRỌNG NHẤT).
- "pic": Tên người phụ trách. CHỈ điền tên người thật có trong văn bản. KHÔNG điền chức danh, KHÔNG bịa tên. Nếu PIC là mã/tên cơ sở (db41, dbpq...) thì để "".
- "target_facilities": MẢNG tên cơ sở nhận việc. Ánh xạ mã: db41→DUBAI 41, dbace→DUBAI ACE, dbpa→DUBAI PA, dbpak→DUBAI PAK, dbpav→DUBAI PAV, dbpq→DUBAI PQ. Ví dụ: ["DUBAI 41","DUBAI ACE"]. Chỉ 1 cơ sở vẫn dùng mảng: ["DUBAI 41"]. Không xác định được thì [].
- "deadline": YYYY-MM-DDTHH:mm (mặc định 17:00).
- "priority_level": URGENT nếu có từ khẩn cấp/gấp/ngay/hỏa tốc, ngược lại PRIORITY.

QUY TẮC TÁCH TASK: Nếu 1 công việc giao cho NHIỀU cơ sở, hãy tạo NHIỀU task riêng biệt — mỗi task có target_facilities là mảng 1 phần tử cho 1 cơ sở. Các trường còn lại (task_title, description, deadline, priority_level) giữ nguyên giống nhau.`;

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

            // [v2] Xử lý mảng task, hỗ trợ target_facilities (mảng nhiều cơ sở)
            const expandedTasks = [];

            for (let t of extractedTasks) {
               // Chuẩn hóa target_facilities: AI mới trả mảng, AI cũ có thể trả string target_facility
               let facilitiesToProcess = [];
               if (Array.isArray(t.target_facilities) && t.target_facilities.length > 0) {
                   facilitiesToProcess = t.target_facilities;
               } else if (t.target_facility) {
                   facilitiesToProcess = [t.target_facility];
               } else {
                   facilitiesToProcess = [null]; // 1 task không xác định cơ sở
               }

               for (const facilityName of facilitiesToProcess) {
                   // --- Resolve Facility ID ---
                   let mappedFacilityId = null;
                   if (facilityName) {
                       const { rows: fRows } = await pool.query('SELECT id, name FROM facilities WHERE name ILIKE $1 LIMIT 1', [`%${facilityName}%`]);
                       if (fRows.length > 0) {
                           mappedFacilityId = fRows[0].id;
                       }
                   }
                   // Fallback về facility của người giao nếu không xác định được
                   if (!mappedFacilityId) {
                       mappedFacilityId = parseSafeFacilityId(facilityId) || parseSafeFacilityId(req.user.facility_id);
                   }

                   // --- Lọc nhân sự theo cơ sở ĐÃ RESOLVE (đúng cơ sở đích, không dùng cơ sở gốc) ---
                   const facilityUsers = mappedFacilityId
                       ? cachedUsers.filter(u => u.facility_id == mappedFacilityId)
                       : cachedUsers;

                   // --- Resolve PIC ---
                   let finalPicId = null;
                   let finalPicName = "";

                   if (t.pic && typeof t.pic === 'string' && t.pic.trim() !== '') {
                       const normalizedInput = normalizeName(t.pic);
                       const matchedUsers = facilityUsers.filter(u =>
                           normalizeName(u.full_name).includes(normalizedInput)
                       );
                       if (matchedUsers.length === 1) {
                           finalPicId = matchedUsers[0].id;
                           finalPicName = matchedUsers[0].full_name;
                       } else if (matchedUsers.length === 0) {
                           // Mở rộng toàn hệ thống nếu không tìm thấy trong cơ sở đích
                           const globalMatched = cachedUsers.filter(u =>
                               normalizeName(u.full_name).includes(normalizedInput)
                           );
                           if (globalMatched.length === 1) {
                               finalPicId = globalMatched[0].id;
                               finalPicName = globalMatched[0].full_name;
                           }
                       }
                       // Nếu matchedUsers.length > 1: không chắc → để null, Fallback sẽ xử lý
                   }

                   // Fallback: AI không tìm ra PIC → Gán Quản lý cơ sở ĐÍ CH (đúng facility đã resolve)
                   if (finalPicId === null) {
                       const facilityManager = facilityUsers.find(u => u.role_id === 6);
                       if (facilityManager) {
                           finalPicId = facilityManager.id;
                           finalPicName = facilityManager.full_name;
                       } else {
                           console.warn(`[Auto-Tasking] Không có Facility Manager (role_id=6) cho facility_id=${mappedFacilityId}`);
                           finalPicName = t.pic || "";
                       }
                   }

                   // Tạo task đã chuẩn hóa
                   expandedTasks.push({
                       task_title: t.task_title,
                       description: t.description || "",
                       pic: finalPicName,
                       pic_id: finalPicId,
                       deadline: t.deadline,
                       target_facility: facilityName || "",
                       facility_id: mappedFacilityId || facilityId,
                       priority_level: t.priority_level === 'URGENT' ? 'URGENT' : 'PRIORITY',
                       created_by_role: req.user.role,
                   });
               }
            }

            extractedTasks = expandedTasks;
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
