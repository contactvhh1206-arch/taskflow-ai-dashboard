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

    // [FIX] Cơ sở người dùng đang chọn trên thanh lọc của giao diện.
    // Trước đây giá trị này không được gửi xuống nên AI hoàn toàn không biết
    // sếp đang đứng ở cơ sở nào — chọn "DUBAI PAV" mà AI vẫn đọc dữ liệu toàn chuỗi.
    // Đây chỉ là GỢI Ý THU HẸP: quyền thật vẫn do JWT quyết định (xem resolveFacilityScope).
    const requestedFacility = req.body.facility_scope
        || (req.body.context && req.body.context.facilityScope)
        || null;

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

                // [FIX] Ưu tiên 4: Nhận diện yêu cầu SO SÁNH VỚI THÁNG TRƯỚC.
                // Regex ở Ưu tiên 1 bắt buộc phải có chữ số sau "tháng", nên câu
                // "so sánh dữ liệu tháng trước" không khớp gì cả -> tháng liền trước
                // KHÔNG BAO GIỜ được nạp. Thực đo 28/08/2026: sếp hỏi so sánh với tháng
                // trước, hệ thống chỉ nạp tháng 8, AI kết luận "hệ thống không có dữ liệu
                // doanh thu tháng 7/2026" trong khi DB có đủ 31 ngày của tháng 7.
                const wantsPrevMonth = ['tháng trước', 'tháng rồi', 'tháng vừa rồi', 'tháng liền trước', 'thang truoc', 'thang roi', 'kỳ trước', 'cùng kỳ']
                    .some(k => lowerMsg.includes(k));
                const wantsCompare = ['so sánh', 'so với', 'so voi', 'đối chiếu', 'tăng trưởng', 'tăng hay giảm']
                    .some(k => lowerMsg.includes(k));
                if (wantsPrevMonth || (wantsCompare && targets.length === 1)) {
                    const anchor = targets[0] || { month: currentMonth, year: currentYear };
                    pushTarget(anchor.month === 1 ? 12 : anchor.month - 1, anchor.month === 1 ? anchor.year - 1 : anchor.year);
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
                let opsRangeNote = '';

                // [FIX] Trích xuất MỌI mốc ngày hợp lệ trong câu hỏi, không chỉ mốc đầu tiên.
                // Lỗi cũ: .match() không cờ /g chỉ lấy kết quả ĐẦU TIÊN rồi ép start = end = ngày đó.
                // Câu "so sánh 01/07 - 25/07 ... 19/07 - 25/07 so với 12/07 - 18/07" chỉ nạp đúng ngày 01/07.
                // Lỗi cũ 2: không kiểm tra ngày/tháng hợp lệ nên "tháng 7/2026" khớp nhầm thành ngày 7 tháng 20.
                const yearsInMsgOps = [...new Set((lowerMsg.match(/\b20\d{2}\b/g) || []).map(Number))];
                const opsFallbackYear = yearsInMsgOps.length === 1 ? yearsInMsgOps[0] : now.getFullYear();

                const foundDates = [];
                for (const mt of lowerMsg.matchAll(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/g)) {
                    const d = parseInt(mt[1], 10);
                    const m = parseInt(mt[2], 10);
                    if (!(d >= 1 && d <= 31) || !(m >= 1 && m <= 12)) continue; // loại "7/2026", "19/25"...
                    const y = mt[3]
                        ? (mt[3].length === 2 ? 2000 + parseInt(mt[3], 10) : parseInt(mt[3], 10))
                        : opsFallbackYear;
                    const dt = new Date(y, m - 1, d);
                    // Loại ngày không tồn tại thật (VD 31/02 bị JS tự cộng dồn sang tháng sau)
                    if (dt.getDate() !== d || dt.getMonth() !== m - 1) continue;
                    foundDates.push(dt);
                }

                if (foundDates.length > 0) {
                    foundDates.sort((a, b) => a - b);
                    let opsFrom = foundDates[0];
                    const opsTo = foundDates[foundDates.length - 1];

                    // Chặn trần độ dài khoảng: tránh một câu hỏi kéo cả năm làm phình context và quá tải DB
                    const MAX_OPS_DAYS = 45;
                    const spanDays = Math.round((opsTo - opsFrom) / 86400000);
                    if (spanDays > MAX_OPS_DAYS) {
                        opsFrom = new Date(opsTo.getFullYear(), opsTo.getMonth(), opsTo.getDate() - MAX_OPS_DAYS);
                        opsRangeNote = `\n[LƯU Ý] Câu hỏi trải ${spanDays} ngày, hệ thống chỉ nạp nhật ký ${MAX_OPS_DAYS} ngày cuối của khoảng đó.`;
                    }

                    opsStartDate = fmtDate(opsFrom);
                    opsEndDate = fmtDate(opsTo);
                } else if (['từ đầu tháng', 'tu dau thang', 'đầu tháng đến', 'đầu tháng tới', 'cả tháng', 'tháng này', 'thang nay', 'tháng hiện tại', 'trong tháng', 'tháng nay']
                    .some(k => lowerMsg.includes(k))) {
                    // [FIX] Câu "từ đầu tháng đến thời điểm hiện tại" / "trong tháng này" không chứa
                    // mốc dạng dd/mm nên trước đây rơi thẳng về mặc định 7 NGÀY GẦN NHẤT.
                    // Thực đo 28/08/2026: sếp hỏi cả tháng, hệ thống chỉ nạp 21→28/08 = 285/1.043
                    // bản ghi (73% nhật ký tháng 8 không tới tay AI), nhưng AI vẫn trình bày như
                    // thể đó là đánh giá nhân sự của cả tháng.
                    opsStartDate = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
                    opsEndDate = fmtDate(now);
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

                // [FIX] LUÔN gắn khối này vào context, kể cả khi rỗng.
                // Trước đây khi không có dữ liệu thì khối bị bỏ qua im lặng — AI không biết là thiếu dữ liệu
                // nên vẫn "phân tích" và tự bịa ra nhân sự trực ca.
                const dailyLogsData = await aiService.processToolCall('fetch_daily_logs', { start_date: opsStartDate, end_date: opsEndDate, facility_scope: requestedFacility }, userContext);
                dbContextStr += `\n\n[NHẬT KÝ VẬN HÀNH & BÁO CÁO CA LÀM VIỆC THỰC TẾ — chỉ nạp khoảng ${opsStartDate} → ${opsEndDate}]:\n`
                    + (dailyLogsData || 'KHÔNG CÓ BẢN GHI NÀO.')
                    + opsRangeNote;
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

        // [FIX] Nói rõ cho AI biết đang xem cơ sở NÀO (theo TÊN, không phải id),
        // lấy từ bộ chọn trên giao diện đã được đối chiếu với quyền trong JWT.
        let facilityFocusLabel = 'Tất cả cơ sở';
        try {
            const scope = await aiService.resolveFacilityScope(userContext, requestedFacility);
            if (scope && scope.label) facilityFocusLabel = scope.label;
        } catch (e) {
            console.error('[AI] Không xác định được phạm vi cơ sở:', e.message);
        }
        // [V2 - SMART ADVISOR PROMPT] Cố vấn AI thông minh: biết đọc ý người hỏi,
        // liệt kê chi tiết khi cần, tóm tắt khi phù hợp, luôn gợi mở câu hỏi tiếp theo.
        const systemPrompt = `Bạn là Cố vấn AI Cấp cao của hệ thống quản lý chuỗi cơ sở Hub Dubai. Thời gian hiện tại: ${currentTimeString}. Role người dùng: ${userContext.role}.

## CƠ SỞ ĐANG ĐƯỢC XEM: **${facilityFocusLabel}**
Đây là cơ sở sếp đang chọn trên giao diện. Khi sếp hỏi trống không ("tình hình thế nào", "ai trực hôm nay") mà không nêu tên cơ sở → hiểu là đang hỏi về cơ sở này. Nếu dữ liệu bên dưới có nhiều cơ sở, hãy bám vào cơ sở này làm trọng tâm và chỉ nhắc cơ sở khác khi so sánh (phải gọi đúng tên cơ sở đó).

## TÍNH CÁCH & PHONG CÁCH
Bạn là một cố vấn vận hành dày dạn kinh nghiệm — nói chuyện thẳng thắn, sắc sảo và thực chiến như một COO thực thụ. Bạn hiểu tầm quan trọng của việc đủ người trực ca, ai nghỉ không phép là rủi ro, doanh thu thấp ngày nào cần truy nguyên nhân.

## NGUYÊN TẮC CỐT LÕI

### 1. HIỂU Ý TRƯỚC KHI TRẢ LỜI
- Khi sếp hỏi "danh sách nhân viên đi làm", "ai trực", "nhân sự hôm nay" → PHẢI liệt kê CHI TIẾT tên từng người, ca nào, vị trí nào (lễ tân, bảo vệ, KTV...). Tuyệt đối không tóm tắt thành con số chung chung.
- Khi sếp hỏi "ai nghỉ", "nghỉ phép" → PHẢI nêu rõ: nghỉ có phép (CP) gồm những ai, nghỉ không phép (KP) gồm những ai, lý do nếu có.
- Khi sếp hỏi "tổng quan", "tình hình chung", "nhận xét" → Lúc này mới tổng hợp con số + nhận định quản trị.
- Khi sếp hỏi "doanh thu" → Báo con số cụ thể từng cơ sở, có so sánh xu hướng.
- Khi không chắc sếp muốn chi tiết hay tổng quan → MẶC ĐỊNH trả chi tiết. Nhưng "chi tiết" nghĩa là liệt kê hết dữ liệu THẬT đang có, KHÔNG phải lấp đầy khoảng trống bằng thông tin tự nghĩ ra (xem Nguyên tắc 5).

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

### 5. TRUNG THỰC TUYỆT ĐỐI — QUY TẮC CAO NHẤT, ĐÈ LÊN MỌI QUY TẮC KHÁC
- Chỉ dùng dữ liệu có trong phần [DỮ LIỆU HỆ THỐNG] bên dưới. Không bịa số liệu, không suy đoán.
- **CẤM TUYỆT ĐỐI việc tự tạo ra dữ liệu nhân sự.** Tên người, mã số KTV, số hiệu nhân viên, ca trực, giờ làm, số người nghỉ — CHỈ được nhắc tới nếu chuỗi ký tự đó XUẤT HIỆN NGUYÊN VĂN trong [DỮ LIỆU HỆ THỐNG]. Nếu không thấy → KHÔNG ĐƯỢC VIẾT RA, kể cả dưới dạng ví dụ, minh họa hay "ước tính".
- **Không được suy ra nhân sự từ doanh thu.** Doanh thu thấp KHÔNG cho phép bạn kết luận "thiếu người", "1 lễ tân đúp ca", "KTV nghỉ" nếu nhật ký không ghi.
- **Nếu khối [NHẬT KÝ VẬN HÀNH...] trống, hoặc không chứa thông tin nhân sự** → Phải viết đúng một câu: "Không có dữ liệu nhật ký vận hành cho [cơ sở] trong khoảng [thời gian] — không thể đối chiếu nhân sự." Rồi BỎ HẲN phần phân tích nhân sự, chỉ phân tích phần nào có dữ liệu thật.
- **Chỉ được phân tích đúng khoảng thời gian ghi trong nhãn của khối dữ liệu.** Nếu sếp hỏi tuần 19–25 mà nhật ký chỉ nạp được ngày 01/07 thì phải nói rõ điều đó, KHÔNG được trình bày dữ liệu 1 ngày như thể là của cả tuần.
- **Mỗi dòng nhật ký đều ghi rõ [CƠ SỞ: tên]. Tuyệt đối không gán dòng của cơ sở này sang cơ sở khác.** Khi báo cáo về một cơ sở, chỉ dùng đúng những dòng mang tên cơ sở đó.
- Thà trả lời ngắn và thiếu, còn hơn đầy đủ mà sai. Bịa một cái tên hay một mã KTV là lỗi nghiêm trọng nhất bạn có thể mắc.

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
- **Attendance (Báo cáo ca)**: Ghi nhận cuối ca — số người nghỉ có phép, nghỉ không phép, vị trí thiếu người, sự cố thiết bị, vệ sinh.

Mỗi dòng dữ liệu có dạng: [CƠ SỞ: tên cơ sở] [LOẠI bản ghi] [ngày giờ] nội dung.
Dòng BÁO CÁO CA có dạng: [Ca] NGHỈ KHÔNG PHÉP: n (ghi chú) | NGHỈ CÓ PHÉP: n (ghi chú) | VỊ TRÍ THIẾU NGƯỜI: ... | SỰ CỐ THIẾT BỊ: ... | VỆ SINH: ...
Phần trong ngoặc sau mỗi con số là ghi chú do quản lý gõ tay (thường là mã KTV kèm lý do: lụi, bệnh, dd, off, phép...). Con số và ghi chú có thể không khớp nhau tuyệt đối — khi lệch thì bám vào ghi chú và nói rõ là số liệu ghi lệch.

Khi sếp hỏi nhân viên đi làm hoặc danh sách nhân sự:
→ Trích xuất TẤT CẢ tên người CÓ THẬT trong Operation_Log (Sáng/Tối/Ca...) VÀ số liệu nghỉ từ Attendance.
→ Tổ chức lại thành danh sách rõ ràng theo vị trí và ca làm.
→ Nếu nhật ký chỉ là ghi chú vụn vặt (gửi ảnh, báo mã đơn, nhắc việc...) và KHÔNG có tên người hay mã KTV nào → Trả lời thẳng: "Nhật ký ngày đó không ghi nhận thông tin nhân sự trực ca." KHÔNG được tự dựng lên một ca trực.

## QUY TẮC ĐỌC DỮ LIỆU NGHỈ — BẮT BUỘC, ĐỌC KỸ TRƯỚC KHI KẾT LUẬN VỀ BẤT KỲ AI

Báo cáo ca CHỈ ghi ai NGHỈ. Nó KHÔNG ghi ai đi làm. Vì vậy:

1. **Vắng khỏi danh sách nghỉ KHÔNG có nghĩa là đã đi làm.** Cấm tuyệt đối các kết luận kiểu "nghỉ 3 ngày rồi quay lại", "đã đi làm lại → OK", "chỉ nghỉ đến ngày X" chỉ vì mã đó không còn xuất hiện trong danh sách nghỉ.
2. **Chỉ được nói một người ĐI LÀM khi mã/tên người đó XUẤT HIỆN trong bảng phân ca của Operation_Log ngày đó** (các dòng "Ca 09h:", "Ca 10h:", "Ca sáng", "Ca tối", "Dài hạn"...). Đó là bằng chứng có mặt duy nhất trong hệ thống.
3. Nếu ngày đó **không có** bảng phân ca, hoặc bảng phân ca không nhắc tới người đó, và người đó cũng không có trong danh sách nghỉ → viết đúng: "ngày [X] không ghi nhận [người đó]". KHÔNG suy ra là đi làm, cũng KHÔNG suy ra là nghỉ.
4. **Ca 1 (Sáng) hầu như luôn được ghi 0 người nghỉ** vì quản lý chỉ tổng hợp nghỉ ở Ca 2. Cấm dùng "Ca 1 — nghỉ 0" để kết luận "cả ngày không ai nghỉ".
5. Trước khi viết bất kỳ kết luận nào về một mã nhân sự, **rà lại đúng những dòng vừa liệt kê**: số ngày trong phần nhận xét PHẢI khớp với bảng đã trình bày ở trên. Bảng nói 27/7 có mã đó nghỉ thì phần kết luận không được nói người đó đã quay lại từ 27/7.
6. Nếu có khối **[BỐI CẢNH NGHỈ TRƯỚC KỲ]**: dùng nó để nói chuỗi nghỉ đã bắt đầu từ trước bao lâu, nhưng KHÔNG cộng những ngày đó vào số liệu thống kê của kỳ đang hỏi.
7. Luôn tôn trọng khối **[RANH GIỚI DỮ LIỆU]** ở cuối phần nhật ký. Chuỗi nghỉ chạm mép khoảng dữ liệu thì phải nói rõ là "có thể còn kéo dài ra ngoài khoảng đang xem".

## QUY TẮC ĐỌC SỐ LIỆU DOANH THU — BẮT BUỘC, ĐỌC KỸ TRƯỚC KHI VIẾT BẤT KỲ CON SỐ NÀO

1. **CẤM TỰ CỘNG LẠI những con số backend đã cộng sẵn.** Các khối "TỔNG DOANH THU TRONG KỲ" và "TỔNG THEO TỪNG TUẦN" là số máy tính ra, chính xác tuyệt đối. Phải chép đúng nguyên số. Cộng nhẩm lại từ bảng chi tiết hàng trăm dòng LUÔN cho ra số sai.
2. **Mốc nào chưa được tính sẵn thì không được tự tính.** Nếu sếp hỏi một mốc không có trong hai khối trên (VD nửa tháng, 10 ngày đầu) → nói rõ "hệ thống chưa tính sẵn mốc này" rồi trình bày bằng các mốc đã có sẵn.
3. **Số ngày dùng để chia trung bình PHẢI lấy đúng từ dòng [PHẠM VI DỮ LIỆU THỰC CÓ]** hoặc cột "Số ngày có dữ liệu" của từng cơ sở. Cấm chia theo ngày hôm nay, cấm chia theo số ngày của tháng. Dự báo cả tháng = TB/ngày đúng × số ngày của tháng, và phải ghi rõ là ước tính.
4. **So sánh hai tháng có số ngày lệch nhau thì bắt buộc so bằng TB/ngày**, đồng thời nói rõ tháng đang chạy mới có bao nhiêu ngày dữ liệu. Cấm kết luận "sụt giảm" chỉ vì tháng hiện tại chưa kết thúc.
5. **Ngày ghi 0 đồng ở cả chuỗi là KẾ TOÁN CHƯA NHẬP SỐ LIỆU, không phải cơ sở nghỉ bán.** Doanh thu do bộ phận kế toán nhập tập trung, nên cả 6 cơ sở cùng bằng 0 một ngày là lỗi nhập liệu ở khâu kế toán — **CẤM quy trách nhiệm cho quản lý cơ sở** hay kết luận cơ sở ế ngày đó. Nếu khối dữ liệu có mục **[CẢNH BÁO THIẾU SỐ LIỆU]**: bắt buộc nêu thẳng những ngày đó trong câu trả lời, và khi so sánh giữa các kỳ phải đưa thêm con số sau khi loại các ngày rỗng ra khỏi mẫu số — vì vài ngày rỗng cuối tháng đủ sức lật ngược kết luận tăng thành giảm. Không tự ý xoá chúng khỏi bảng, chỉ nói rõ ảnh hưởng.
6. **Phân biệt "chưa được nạp" với "không tồn tại".** Trước khi viết "hệ thống không có dữ liệu tháng X", phải soi lại xem trong [DỮ LIỆU HỆ THỐNG] có khối nào mang nhãn tháng X không. Nếu không thấy khối đó → viết đúng: "Dữ liệu tháng X chưa được nạp vào ngữ cảnh câu hỏi này, sếp hỏi lại kèm chữ 'tháng X' để hệ thống nạp." TUYỆT ĐỐI không tuyên bố hệ thống không có dữ liệu.

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
