const pool = require('../config/database');
const taskService = require('./taskService');

// ==============================================================================
// BỘ GIẢI PHẠM VI CƠ SỞ CHO AI (AI FACILITY SCOPE RESOLVER)
// ------------------------------------------------------------------------------
// Lý do tồn tại: trước đây mỗi tool tự lọc theo `userContext.facility_id`. Tài khoản
// SUPERVISOR được tạo với facility_id = NULL (danh sách nằm ở `managed_facilities`),
// nên điều kiện `if (facility_id)` bị bỏ qua → AI nhận nhật ký của TOÀN BỘ cơ sở.
// Module này là nguồn chân lý duy nhất: không có quyền = KHÔNG thấy gì (fail-closed).
// ==============================================================================

const AI_GLOBAL_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'];

// Chuẩn hóa chuỗi để so khớp tên cơ sở: bỏ dấu, bỏ khoảng trắng thừa, về chữ thường
const normFacilityKey = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Tách mọi định dạng đang tồn tại trong DB/JWT thành mảng token phẳng:
// 5 | "5" | "ALL" | '["DUBAI PAV","DUBAI PA"]' | ["DUBAI PAV"] | "a, b"
const parseFacilityTokens = (raw) => {
    if (raw === null || raw === undefined || raw === '') return [];
    if (Array.isArray(raw)) return raw.flatMap(parseFacilityTokens);
    if (typeof raw === 'number') return [String(raw)];

    const str = String(raw).trim();
    if (str === '') return [];

    if (str.startsWith('[')) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return parsed.flatMap(parseFacilityTokens);
        } catch (e) { /* không phải JSON hợp lệ → xử lý như chuỗi thường bên dưới */ }
    }

    if (str.includes(',')) return str.split(',').map(s => s.trim()).filter(Boolean);
    return [str];
};

/**
 * Trả về danh sách ID cơ sở (dạng chuỗi) mà user được phép xem.
 *   null  = xem được TẤT CẢ cơ sở (lãnh đạo / được gán 'ALL')
 *   []    = KHÔNG được xem cơ sở nào (tài khoản chưa gán cơ sở → fail-closed)
 * Token có thể là id hoặc TÊN cơ sở (SUPERVISOR lưu theo tên) nên khớp cả hai.
 */
const resolveAllowedFacilityIds = async (userContext) => {
    if (!userContext || !userContext.role) return [];
    if (AI_GLOBAL_ROLES.includes(userContext.role)) return null;

    const tokens = [
        ...parseFacilityTokens(userContext.facility_id),
        ...parseFacilityTokens(userContext.managed_facilities)
    ];

    if (tokens.some(t => String(t).toUpperCase() === 'ALL')) return null;
    if (tokens.length === 0) return [];

    const { rows } = await pool.query('SELECT id::text AS id, name, code FROM facilities');
    const wanted = new Set(tokens.map(normFacilityKey));

    const matched = rows
        .filter(f => wanted.has(normFacilityKey(f.id))
                  || wanted.has(normFacilityKey(f.name))
                  || (f.code && wanted.has(normFacilityKey(f.code))))
        .map(f => f.id);

    return [...new Set(matched)];
};

/**
 * Gộp quyền (allowed) với cơ sở người dùng đang chọn trên giao diện (requested).
 * Nguyên tắc: lựa chọn trên UI chỉ được THU HẸP phạm vi, KHÔNG BAO GIỜ mở rộng.
 * Trả về { ids, label } — ids = null nghĩa là không lọc (tất cả cơ sở được phép).
 */
const resolveFacilityScope = async (userContext, requestedFacility) => {
    const allowed = await resolveAllowedFacilityIds(userContext);
    const { rows } = await pool.query('SELECT id::text AS id, name, code FROM facilities');

    const nameOf = (ids) => rows.filter(f => ids.includes(f.id)).map(f => f.name).join(', ');
    // Nhãn mô tả phạm vi khi người dùng KHÔNG chọn cơ sở cụ thể
    const baseLabel = allowed === null
        ? 'Tất cả cơ sở'
        : (allowed.length === 0 ? 'CHƯA ĐƯỢC GÁN CƠ SỞ NÀO' : nameOf(allowed));

    const reqTokens = parseFacilityTokens(requestedFacility)
        .filter(t => String(t).toUpperCase() !== 'ALL');

    if (reqTokens.length === 0) return { ids: allowed, label: baseLabel };

    const wanted = new Set(reqTokens.map(normFacilityKey));
    const requestedRows = rows.filter(f => wanted.has(normFacilityKey(f.id))
                                        || wanted.has(normFacilityKey(f.name))
                                        || (f.code && wanted.has(normFacilityKey(f.code))));

    // Không khớp cơ sở nào (VD đang chọn "Phòng Truyền thông") → giữ nguyên quyền gốc
    if (requestedRows.length === 0) return { ids: allowed, label: baseLabel };

    // Giao với quyền được cấp: chọn cơ sở ngoài quyền thì bị bỏ qua, KHÔNG được nới quyền
    const finalRows = allowed === null
        ? requestedRows
        : requestedRows.filter(f => allowed.includes(f.id));

    if (finalRows.length === 0) return { ids: allowed, label: baseLabel };

    return {
        ids: finalRows.map(f => f.id),
        label: finalRows.map(f => f.name).join(', ')
    };
};

// ==============================================================================
// BỘ ĐỌC BÁO CÁO CA (ATTENDANCE) TỪ CỘT `content` DẠNG JSONB
// ------------------------------------------------------------------------------
// Trước đây AI chỉ nhận `ai_vector_data` — một chuỗi phẳng do frontend ghép sẵn.
// Chuỗi đó bỏ rơi `eq_other` (sự cố thiết bị khác) và `cleaning_done` (vệ sinh),
// đồng thời phụ thuộc vào định dạng chuỗi nên rất dễ vỡ. Cột `content` là jsonb
// và ĐỦ KHÓA trên 100% bản ghi Attendance hiện có, nên đọc thẳng từ đó an toàn hơn.
// Vẫn giữ fallback về `ai_vector_data` nếu gặp bản ghi có cấu trúc lạ.
// ==============================================================================

const HR_LABELS = { hr_letan: 'LỄ TÂN', hr_baove: 'BẢO VỆ', hr_clocker: 'LOCKER', hr_ktv: 'KTV' };
const EQ_LABELS = { eq_camera: 'CAMERA', eq_maytinh: 'MÁY TÍNH', eq_den: 'ĐÈN', eq_maylanh: 'MÁY LẠNH' };

// Kiểm tra một bản ghi Attendance có đọc được theo cấu trúc hay không
const isUsableAttendanceContent = (c) =>
    !!c && typeof c === 'object' && !Array.isArray(c)
    && (c.manual_auth !== undefined || c.manual_unauth !== undefined);

const cleanNote = (v) => String(v == null ? '' : v).trim();

// Cụm "ai nghỉ" — dùng chung cho cả dòng chi tiết lẫn dòng bối cảnh trước kỳ.
// LUÔN in ra cả 2 loại nghỉ kể cả khi bằng 0, để AI phân biệt được
// "ca này ghi nhận 0 người nghỉ" với "ca này không được ghi nhận".
const buildLeaveSegment = (c) => {
    const kp = Number(c.manual_unauth || 0);
    const cp = Number(c.manual_auth || 0);
    const kpNote = cleanNote(c.manual_unauth_note);
    const cpNote = cleanNote(c.manual_auth_note);
    return `NGHỈ KHÔNG PHÉP: ${kp}${kp > 0 ? ` (${kpNote || 'không ghi chú'})` : ''}`
        + ` | NGHỈ CÓ PHÉP: ${cp}${cp > 0 ? ` (${cpNote || 'không ghi chú'})` : ''}`;
};

// Dòng chi tiết đầy đủ của một bản ghi Attendance
const buildAttendanceDetail = (c) => {
    const parts = [];
    parts.push(buildLeaveSegment(c));

    const hrNotes = Object.entries(HR_LABELS)
        .filter(([k]) => c[k] && c[k].status === 'thieu')
        .map(([k, label]) => `${label}: ${cleanNote(c[k].note) || 'không ghi chú'}`);
    parts.push(`VỊ TRÍ THIẾU NGƯỜI: ${hrNotes.length ? hrNotes.join(' ; ') : 'không có'}`);

    const eqNotes = Object.entries(EQ_LABELS)
        .filter(([k]) => c[k] === 'su_co')
        .map(([k, label]) => `${label}: ${cleanNote(c[`${k}_note`]) || 'không ghi chú'}`);
    if (cleanNote(c.eq_other)) eqNotes.push(`KHÁC: ${cleanNote(c.eq_other)}`);
    parts.push(`SỰ CỐ THIẾT BỊ: ${eqNotes.length ? eqNotes.join(' ; ') : 'không có'}`);

    parts.push(`VỆ SINH: ${c.cleaning_done ? 'đã hoàn thành' : 'CHƯA hoàn thành'}`);
    return `${c.shift ? `[${c.shift}] ` : ''}${parts.join(' | ')}`;
};

// 1. Schema Định nghĩa Tool (Hoàn toàn KHÔNG CÓ tham số định danh cơ sở)
const AI_TOOLS = [
    {
        type: "function",
        function: {
            name: "fetch_kanban_tasks",
            description: "Lấy danh sách công việc trên bảng Kanban. Dùng khi User hỏi về tình hình công việc, tiến độ, báo cáo.",
            parameters: {
                type: "object",
                properties: {
                    status: {
                        type: "string",
                        description: "Trạng thái công việc cần lọc (ví dụ: 'todo', 'in_progress', 'done')"
                    },
                    urgency: {
                        type: "boolean",
                        description: "Lọc các công việc đang ở trạng thái khẩn cấp (true/false)"
                    },
                    start_date: {
                        type: "string",
                        description: "Ngày bắt đầu lọc (YYYY-MM-DD)"
                    },
                    end_date: {
                        type: "string",
                        description: "Ngày kết thúc lọc (YYYY-MM-DD)"
                    },
                    limit: {
                        type: "number",
                        description: "Số lượng công việc tối đa cần lấy (max 1000)"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fetch_financial_reports",
            description: "Lấy báo cáo doanh thu chi tiết. Dùng khi User hỏi chi tiết doanh thu.",
            parameters: {
                type: "object",
                properties: {
                    start_date: {
                        type: "string",
                        description: "Ngày bắt đầu lọc (YYYY-MM-DD)"
                    },
                    end_date: {
                        type: "string",
                        description: "Ngày kết thúc lọc (YYYY-MM-DD)"
                    },
                    limit: {
                        type: "number",
                        description: "Số lượng báo cáo tối đa cần lấy (max 1000)"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fetch_revenue_summary",
            description: "Tính tổng doanh thu theo tháng/kỳ y hệt như trên giao diện Dashboard. Dùng tool này khi User hỏi về tổng doanh thu của cơ sở.",
            parameters: {
                type: "object",
                properties: {
                    month: {
                        type: "number",
                        description: "Tháng cần xem (1-12)"
                    },
                    year: {
                        type: "number",
                        description: "Năm cần xem"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fetch_daily_logs",
            description: "Lấy nhật ký vận hành và báo cáo ca làm việc hằng ngày (Attendance & Operation_Log) từ bảng daily_logs. Dùng khi User hỏi về ca làm, nhật ký vận hành, KTV, lễ tân, nhân sự trực ca, thiết bị, vệ sinh, sự cố vận hành.",
            parameters: {
                type: "object",
                properties: {
                    start_date: {
                        type: "string",
                        description: "Ngày bắt đầu lọc (YYYY-MM-DD). Mặc định là 3 ngày gần nhất."
                    },
                    end_date: {
                        type: "string",
                        description: "Ngày kết thúc lọc (YYYY-MM-DD)"
                    },
                    entry_type: {
                        type: "string",
                        description: "Loại dữ liệu: 'Attendance' (báo cáo ca), 'Operation_Log' (nhật ký vận hành). Bỏ trống để lấy cả 2."
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fetch_kpi_analysis",
            description: "Lấy chỉ tiêu KPI doanh thu (ngày thường & cuối tuần) của từng cơ sở và tự động đối chiếu với doanh thu thực tế để phân tích hiệu suất, tính % hoàn thành, dự báo và đề xuất phương án kinh doanh. Dùng khi User hỏi về KPI, chỉ tiêu, mục tiêu doanh thu, hiệu suất cơ sở, phương án kinh doanh, đánh giá cơ sở, cơ sở có đạt chỉ tiêu không, tư vấn doanh thu.",
            parameters: {
                type: "object",
                properties: {
                    month: {
                        type: "number",
                        description: "Tháng cần phân tích (1-12). Mặc định là tháng hiện tại."
                    },
                    year: {
                        type: "number",
                        description: "Năm cần phân tích. Mặc định là năm hiện tại."
                    }
                }
            }
        }
    }
];

// 2. Bộ xử lý Lệnh Tool (Cơ chế Sandbox Tiêm ngầm)
const processToolCall = async (functionName, functionArgs, userContext) => {
    try {
        if (functionName === 'fetch_kanban_tasks') {
            const { status, urgency, start_date, end_date, limit } = functionArgs || {};
            
            // TIÊM NGẦM BẮT BUỘC
            const args = {
                status,
                urgency,
                start_date,
                end_date,
                userId: userContext.id,
                role: userContext.role,
                facilityId: userContext.facility_id,
                departmentCode: userContext.department_code,
                limit: limit ? Math.min(limit, 1000) : 500 // Mở khóa limit
            };

            const { rows } = await taskService.getTasksList(args);
            
            if (!rows || rows.length === 0) {
                return "Hệ thống báo cáo: Không có công việc nào thỏa mãn điều kiện.";
            }

            // [FIX VẤN ĐỀ 2] TINH GỌN RAG: Bổ sung đầy đủ trường nhật ký vận hành
            const simplifiedData = rows.map(t => {
                const assignee = t.assignee_name || t.pic || "Chưa giao";
                const dueDate = t.deadline ? new Date(t.deadline).toLocaleDateString('vi-VN') : "Không có";
                const isUrgent = t.urgent ? "[KHẨN]" : "";
                let base = `[ID: ${t.id}] ${isUrgent} ${t.title} - Status: ${t.status} - Phụ trách: ${assignee} - Hạn chót: ${dueDate}`;

                // Đính kèm nhật ký vận hành nếu task có dữ liệu từ bảng task_operations
                const ops = [];
                if (t.shift)                    ops.push(`Ca: ${t.shift}`);
                if (t.clocker_present != null)  ops.push(`Lễ tân có mặt: ${t.clocker_present}`);
                if (t.clocker_absent_unexcused != null && t.clocker_absent_unexcused > 0)
                                                ops.push(`Lễ tân vắng không phép: ${t.clocker_absent_unexcused}`);
                if (t.ktv_present != null)       ops.push(`KTV có mặt: ${t.ktv_present}`);
                if (t.ktv_absent_unexcused != null && t.ktv_absent_unexcused > 0)
                                                ops.push(`KTV vắng không phép: ${t.ktv_absent_unexcused}`);
                if (t.machinery_ok === false)    ops.push(`⚠️ Thiết bị có sự cố`);
                if (t.repair_needed === true)    ops.push(`⚠️ Cần sửa chữa`);
                if (t.cleaning_done === false)   ops.push(`⚠️ Vệ sinh chưa hoàn thành`);
                if (t.incidents && t.incidents.trim() !== '')
                                                ops.push(`Sự cố: ${t.incidents}`);

                if (ops.length > 0) {
                    base += ` | [NHẬT KÝ VẬN HÀNH: ${ops.join(', ')}]`;
                }

                return base;
            }).join('\n');
            
            return simplifiedData;
        }

        if (functionName === 'fetch_revenue_summary') {
            try {
                const { month, year } = functionArgs || {};
                const currentYear = new Date().getFullYear();
                const targetYear = year || currentYear;
                let startDate, endDate;
                
                if (month) {
                    startDate = new Date(targetYear, month - 1, 1);
                    endDate = new Date(targetYear, month, 0, 23, 59, 59, 999);
                } else {
                    // [FIX VẤN ĐỀ 1] Fallback an toàn: Mặc định về tháng hiện tại
                    // thay vì lấy toàn bộ năm (1/1 - 31/12) gây cộng dồn sai
                    const nowFallback = new Date();
                    const fallbackMonth = nowFallback.getMonth() + 1;
                    startDate = new Date(targetYear, fallbackMonth - 1, 1);
                    endDate = new Date(targetYear, fallbackMonth, 0, 23, 59, 59, 999);
                }

                const facRes = await pool.query('SELECT * FROM facilities');
                const facilityList = facRes.rows;
                
                // [FIX] Lọc THẲNG theo ngày trong SQL thay vì bốc 500 dòng mới nhất rồi lọc bằng JS.
                // Bảng daily_financial_reports mỗi ngày sinh đúng 1 dòng, nên `LIMIT 500` = 500 ngày
                // gần nhất. Khi bảng vượt 500 dòng (khoảng 09/2027) thì tháng cũ rơi ra ngoài cửa sổ
                // TRONG IM LẶNG: tháng vắt ngang ranh giới sẽ trả về tổng THIẾU nhưng vẫn được dán
                // nhãn "TỔNG DOANH THU CHUẨN" — đúng loại lỗi số sai mà trông chắc chắn.
                // Cột date là chuỗi 'YYYY-MM-DD' nên so sánh chuỗi chính là so sánh thời gian;
                // không ép kiểu ::date để một dòng lỡ ghi sai định dạng không làm chết cả truy vấn.
                const fmtSqlDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const repRes = await pool.query(
                    'SELECT * FROM daily_financial_reports WHERE date >= $1 AND date <= $2 ORDER BY date DESC',
                    [fmtSqlDate(startDate), fmtSqlDate(endDate)]
                );
                const allReports = repRes.rows;

                const isAllowedAll = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(userContext.role);
                const allowedFacs = Array.isArray(userContext.facility_id) ? userContext.facility_id : [String(userContext.facility_id)];
                const hasAll = allowedFacs.includes('ALL');

                const aggregated = {};
                const activeFacs = facilityList.filter(f => f.is_active !== false);
                const defaultFacs = activeFacs.length > 0 ? activeFacs : Array.from({length: 6}, (_, i) => ({id: `f${i+1}`, name: `Cơ sở ${i+1}`}));
                
                defaultFacs.forEach(f => {
                    const fname = String(f.name || '').toUpperCase();
                    if (['MARKETING', 'MAKETING', 'FINANCE', 'BGD'].some(k => fname.includes(k))) return;

                    if (isAllowedAll || hasAll || allowedFacs.includes(String(f.id)) || allowedFacs.includes(f.name)) {
                        aggregated[f.name] = { id: f.id, name: f.name, revenue: 0 };
                    }
                });

                const timeFiltered = allReports.filter(r => {
                    if (!r.date) return false;
                    const rParts = r.date.split('-');
                    const rDate = new Date(rParts[0], rParts[1]-1, rParts[2]);
                    return rDate >= startDate && rDate <= endDate;
                });

                timeFiltered.forEach(r => {
                    const rData = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                    if (rData && Array.isArray(rData)) {
                        rData.forEach(facData => {
                            const fname = String(facData.name || '').toUpperCase();
                            if (fname.includes('MARKETING') || fname.includes('MAKETING') || fname.includes('FINANCE') || fname.includes('BGD')) return;
                            if (aggregated[facData.name]) {
                                aggregated[facData.name].revenue += Number(facData.revenue || 0);
                            }
                        });
                    }
                });

                // [FIX] Ghi rõ PHẠM VI DỮ LIỆU THỰC CÓ và tính sẵn TB/ngày.
                // Trước đây khối này chỉ ghi nhãn "THÁNG 8" rồi liệt kê tổng, không hề nói
                // dữ liệu dừng ở ngày nào. AI lấy ngày hiện tại (28) làm mẫu số trong khi
                // hệ thống mới có 26 ngày số liệu -> mọi TB/ngày và dự báo lệch ~7,7%.
                const coveredDays = [...new Set(timeFiltered.map(r => String(r.date)))].sort();
                const dayCount = coveredDays.length;

                const displayMonth = month || (new Date().getMonth() + 1);
                const facLines = [];
                for (const fac of Object.values(aggregated)) {
                    if (fac.revenue > 0) {
                        const avg = dayCount > 0 ? Math.round(fac.revenue / dayCount) : 0;
                        facLines.push(`- Cơ sở: ${fac.name} | TỔNG DOANH THU: ${fac.revenue} VNĐ | TB/ngày: ${avg} VNĐ`);
                    }
                }

                if (facLines.length === 0) {
                    return "Hệ thống không có dữ liệu doanh thu cho thời gian này.";
                }

                return `[TỔNG DOANH THU THÁNG ${displayMonth}/${targetYear}]\n`
                    + `[PHẠM VI DỮ LIỆU THỰC CÓ] ${dayCount} ngày có số liệu, từ ${coveredDays[0]} đến ${coveredDays[dayCount - 1]}.`
                    + ` Mọi trung bình/ngày và mọi dự báo PHẢI chia cho ${dayCount} — KHÔNG chia theo ngày hiện tại, KHÔNG chia theo số ngày của tháng.\n`
                    + facLines.join('\n') + '\n';
            } catch (e) {
                console.error("Lỗi fetch_revenue_summary:", e);
                return "Hệ thống gặp lỗi khi tính toán tổng doanh thu.";
            }
        }

        if (functionName === 'fetch_financial_reports') {
            const { start_date, end_date, limit } = functionArgs || {};
            const queryLimit = limit ? Math.min(limit, 1000) : 500;
            
            const query = `
                WITH AllowedFacs AS (
                    SELECT id::text AS id, name::text AS name FROM facilities WHERE $1::text[] IS NULL OR id::text = ANY($1::text[])
                ),
                RecentDates AS (
                    SELECT DISTINCT date
                    FROM daily_financial_reports
                    WHERE ($2::date IS NULL OR date::date >= $2::date)
                      AND ($3::date IS NULL OR date::date <= $3::date)
                    ORDER BY date DESC
                    LIMIT $4
                )
                SELECT d.date AS formatted_date, SUM(CAST(elem->>'revenue' AS NUMERIC)) AS revenue_amount, elem->>'name' AS facility_name
                FROM daily_financial_reports d
                JOIN RecentDates rd ON d.date = rd.date,
                     jsonb_array_elements(CASE WHEN jsonb_typeof(d.data::jsonb) = 'array' THEN d.data::jsonb ELSE '[]'::jsonb END) AS elem
                WHERE ($1::text[] IS NULL OR elem->>'id' IN (SELECT id FROM AllowedFacs) OR elem->>'name' IN (SELECT name FROM AllowedFacs))
                GROUP BY d.date, elem->>'name'
                ORDER BY d.date DESC;
            `;
            
            // Xử lý lãnh đạo vs quản lý cơ sở
            let facilityParam = null;
            if (userContext.role !== 'SUPER_ADMIN' && userContext.role !== 'VICE_PRESIDENT' && userContext.role !== 'ADMIN' && userContext.facility_id !== 'ALL') {
                if (Array.isArray(userContext.facility_id)) {
                    facilityParam = userContext.facility_id;
                } else if (typeof userContext.facility_id === 'string') {
                    facilityParam = userContext.facility_id.split(',').map(s => s.trim());
                } else {
                    facilityParam = [String(userContext.facility_id)];
                }
            }
                
            const { rows } = await pool.query(query, [facilityParam, start_date || null, end_date || null, queryLimit]);

            if (!rows || rows.length === 0) {
                return "Hệ thống báo cáo: Không có dữ liệu doanh thu cho khoảng thời gian này.";
            }

            // ------------------------------------------------------------------
            // [FIX] PHẠM VI DỮ LIỆU THỰC CÓ + TỔNG TỪNG TUẦN ĐƯỢC TÍNH SẴN
            //
            // Hai lỗi thực đo ngày 28/08/2026 mà khối này gây ra:
            //  (1) Nhãn khối ghi "THÁNG 8" nhưng dữ liệu chỉ tới 26/08. AI chia trung bình
            //      cho 28 (ngày hiện tại) -> TB/ngày và dự báo của cả 6 cơ sở thấp hơn
            //      thực tế ~7,7%. Nay ghi thẳng số ngày CÓ dữ liệu vào context.
            //  (2) Context chỉ có 1 con số tổng kỳ + ~156 dòng ngày, nên mọi mốc nhỏ hơn
            //      (tuần 1, tuần 2...) đều do AI cộng nhẩm -> sai tới 3.000 VNĐ/tuần
            //      (ACE tuần 4: AI 102.080 / thực 105.080, đảo ngược cả nhận định xu hướng).
            //      Nay backend cộng sẵn theo tuần, AI chỉ việc đọc.
            // ------------------------------------------------------------------
            const allDates = [...new Set(rows.map(r => String(r.formatted_date)))].sort();
            const coverStart = allDates[0];
            const coverEnd = allDates[allDates.length - 1];

            // Mốc chia tuần lấy theo ngày bắt đầu người dùng hỏi (nếu có) để "Tuần 1"
            // luôn là 01-07 của tháng, đúng cách quản lý cơ sở vẫn đọc số.
            const toUTC = (s) => { const p = String(s).split('-'); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
            const anchorMs = toUTC(start_date || coverStart);
            const weekIndexOf = (d) => Math.max(0, Math.floor((toUTC(d) - anchorMs) / 604800000));
            const ddmm = (s) => { const p = String(s).split('-'); return `${p[2]}/${p[1]}`; };

            // summary[cơ sở] = { total, days:Set, zeroDays:Set, weeks: { chỉ số tuần: { total, days:Set } } }
            const summary = {};
            for (const r of rows) {
                const fac = r.facility_name;
                if (!summary[fac]) summary[fac] = { total: 0, days: new Set(), zeroDays: new Set(), weeks: {} };
                const s = summary[fac];
                const amount = Number(r.revenue_amount || 0);
                const day = String(r.formatted_date);
                s.total += amount;
                s.days.add(day);
                if (amount === 0) s.zeroDays.add(day);
                const wi = weekIndexOf(day);
                if (!s.weeks[wi]) s.weeks[wi] = { total: 0, days: new Set() };
                s.weeks[wi].total += amount;
                s.weeks[wi].days.add(day);
            }

            const resultLines = [];
            resultLines.push(`[PHẠM VI DỮ LIỆU THỰC CÓ] Khoảng được hỏi: ${start_date || 'không giới hạn'} → ${end_date || 'không giới hạn'}.`
                + ` Hệ thống CHỈ có số liệu từ ${coverStart} đến ${coverEnd} = ${allDates.length} ngày.`);
            resultLines.push(`[BẮT BUỘC KHI TÍNH TOÁN] Mọi trung bình/ngày và mọi dự báo phải chia đúng cho số ngày có dữ liệu ghi ở trên,`
                + ` hoặc số ngày riêng của từng cơ sở ghi trong bảng tổng. TUYỆT ĐỐI không chia theo ngày hiện tại, không chia theo số ngày của tháng,`
                + ` và không coi những ngày chưa có số liệu là doanh thu bằng 0.`);

            // ------------------------------------------------------------------
            // [MỚI] CẢNH BÁO NGÀY GHI 0 ĐỒNG
            // Thực tế 30/07 và 31/07/2026 được ghi 0 đồng ở CẢ 6 cơ sở — quản lý quên nhập
            // báo cáo chứ không phải nghỉ bán. Hai ngày rỗng đó kéo TB/ngày tháng 7 xuống ~7%,
            // đủ để lật kết luận cả chuỗi tháng 8 từ "+3,7%" thành "-3,0%" mà không ai hay.
            // Ngày 0 đồng vẫn là một dòng dữ liệu hợp lệ nên không thể tự động loại — nhưng
            // bắt buộc phải đập vào mắt AI để nó nêu ra thay vì lặng lẽ chia trung bình.
            // ------------------------------------------------------------------
            const totalByDate = {};
            for (const r of rows) {
                const day = String(r.formatted_date);
                totalByDate[day] = (totalByDate[day] || 0) + Number(r.revenue_amount || 0);
            }
            const zeroAllDates = allDates.filter(d => (totalByDate[d] || 0) === 0);
            const facZeroLines = Object.entries(summary)
                .map(([fac, s]) => {
                    const z = [...s.zeroDays].filter(d => !zeroAllDates.includes(d)).sort();
                    return z.length ? `${fac}: ${z.map(ddmm).join(', ')}` : null;
                })
                .filter(Boolean);

            if (zeroAllDates.length > 0) {
                resultLines.push(`[CẢNH BÁO THIẾU SỐ LIỆU] Các ngày sau ghi 0 đồng ở TẤT CẢ cơ sở: ${zeroAllDates.map(ddmm).join(', ')}.`
                    + ` Cả chuỗi cùng bằng 0 trong một ngày gần như luôn là quản lý CHƯA NHẬP báo cáo, không phải nghỉ bán.`
                    + ` BẮT BUỘC nêu rõ điều này trong câu trả lời, và khi so sánh giữa các kỳ phải nói thêm con số nếu loại những ngày đó ra khỏi mẫu số.`);
            }
            if (facZeroLines.length > 0) {
                resultLines.push(`[LƯU Ý] Ngày ghi 0 đồng ở riêng từng cơ sở (các cơ sở khác vẫn có doanh thu) — ${facZeroLines.join(' ; ')}.`);
            }
            resultLines.push('');
            resultLines.push("=== TỔNG DOANH THU TRONG KỲ (BACKEND ĐÃ CỘNG SẴN — AI PHẢI DÙNG ĐÚNG SỐ NÀY, CẤM TỰ CỘNG LẠI) ===");
            for (const [fac, s] of Object.entries(summary)) {
                const d = s.days.size || 1;
                resultLines.push(`- Cơ sở: ${fac} | TỔNG DOANH THU: ${s.total} VNĐ | Số ngày có dữ liệu: ${s.days.size} | TB/ngày: ${Math.round(s.total / d)} VNĐ`);
            }

            const weekIdxs = [...new Set(allDates.map(weekIndexOf))].sort((a, b) => a - b);
            if (weekIdxs.length > 1) {
                resultLines.push('');
                resultLines.push("=== TỔNG THEO TỪNG TUẦN (BACKEND ĐÃ CỘNG SẴN — CẤM TỰ CỘNG LẠI TỪ BẢNG NGÀY BÊN DƯỚI) ===");
                for (const [fac, s] of Object.entries(summary)) {
                    for (const wi of weekIdxs) {
                        const w = s.weeks[wi];
                        if (!w) continue;
                        const wd = [...w.days].sort();
                        resultLines.push(`- ${fac} | Tuần ${wi + 1} (${ddmm(wd[0])}–${ddmm(wd[wd.length - 1])}, ${wd.length} ngày):`
                            + ` TỔNG ${w.total} VNĐ | TB/ngày ${Math.round(w.total / wd.length)} VNĐ`);
                    }
                }
            }

            resultLines.push("======================================================================");
            resultLines.push("=== CHI TIẾT DOANH THU TỪNG NGÀY ===");

            for (const r of rows) {
                resultLines.push(`[Cơ sở: ${r.facility_name}] Ngày: ${r.formatted_date} - Doanh thu: ${r.revenue_amount || 0} VNĐ`);
            }

            return resultLines.join('\n');
        }

        if (functionName === 'fetch_daily_logs') {
            const { start_date, end_date, entry_type, facility_scope } = functionArgs || {};

            // [FIX] Phân quyền qua resolver dùng chung: hiểu cả facility_id lẫn managed_facilities,
            // và tôn trọng cơ sở người dùng đang chọn trên giao diện (chỉ được thu hẹp, không nới quyền).
            const scope = await resolveFacilityScope(userContext, facility_scope);

            // Mặc định lấy 3 ngày gần nhất nếu không truyền start_date
            // Định dạng ngày DD/MM/YYYY cho khớp với dữ liệu thực tế trong cột date của bảng daily_logs
            const defaultStart = new Date();
            defaultStart.setDate(defaultStart.getDate() - 3);
            const fmt = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            const effectiveStart = start_date || fmt(defaultStart);
            const effectiveEnd = end_date || fmt(new Date());

            // scope.ids === null → được xem tất cả cơ sở, không thêm điều kiện lọc.
            // scope.ids === []   → tài khoản chưa được gán cơ sở nào: CHẶN, không trả dữ liệu
            //                      (trước đây trường hợp này lọt qua và trả log của toàn bộ chuỗi).
            if (Array.isArray(scope.ids) && scope.ids.length === 0) {
                return 'KHÔNG CÓ QUYỀN: Tài khoản của bạn chưa được gán cơ sở nào nên hệ thống không nạp được nhật ký vận hành. Vui lòng liên hệ quản trị hệ thống để gán cơ sở.';
            }

            // [FIX] JOIN facilities để mỗi dòng log gửi cho AI đều mang TÊN CƠ SỞ.
            // Trước đây chỉ trả `[ngày] nội dung` khiến AI nhận log của 6 cơ sở trộn lẫn
            // mà không biết dòng nào của ai, dẫn tới gán nhầm dữ liệu cho cơ sở người dùng hỏi.
            //
            // [FIX] DISTINCT ON để khử bản ghi trùng. Mỗi lần quản lý bấm lưu nhật ký là một
            // dòng MỚI, nên cùng một nội dung có thể nằm 3-4 dòng (thực đo tuần 24-30/07:
            // 285 dòng nhưng chỉ 257 nội dung khác nhau). Trùng lặp ăn hạn mức ROW_LIMIT.
            let innerQuery = `
                SELECT DISTINCT ON (l.org_unit, l.date, l.entry_type, l.ai_vector_data)
                       l.org_unit, l.entry_type, l.date, l.display_time, l.ai_vector_data, l.content,
                       TO_DATE(l.date, 'DD/MM/YYYY') AS real_date,
                       COALESCE(f.name, 'KHÔNG XÁC ĐỊNH (org_unit=' || COALESCE(l.org_unit::text, 'null') || ')') AS facility_name
                FROM daily_logs l
                LEFT JOIN facilities f ON f.id::text = l.org_unit::text
                WHERE TO_DATE(l.date, 'DD/MM/YYYY') >= TO_DATE($1, 'DD/MM/YYYY')
                  AND TO_DATE(l.date, 'DD/MM/YYYY') <= TO_DATE($2, 'DD/MM/YYYY')
            `;
            const params = [effectiveStart, effectiveEnd];

            if (Array.isArray(scope.ids)) {
                params.push(scope.ids);
                innerQuery += ` AND l.org_unit::text = ANY($${params.length}::text[])`;
            }

            if (entry_type) {
                params.push(entry_type);
                innerQuery += ` AND l.entry_type = $${params.length}`;
            }

            // [FIX] Sắp xếp theo NGÀY THẬT. Cột date là TEXT 'DD/MM/YYYY' nên `ORDER BY date DESC`
            // trước đây sắp theo thứ tự chữ cái (ngày trong tháng), làm LIMIT cắt nhầm dữ liệu.
            // [FIX] 900 không đủ cho câu hỏi cả tháng: thực đo 01→28/08/2026 toàn chuỗi có
            // 928 dòng sau khi khử trùng (1.043 dòng thô). Nâng lên 1.600 để phủ trọn một
            // tháng; phần chặn thực sự là ngân sách ký tự bên dưới, không phải số dòng.
            // Bảng daily_logs chỉ ~3.000 dòng nên nâng trần không gây rủi ro tải.
            const ROW_LIMIT = 1600;
            innerQuery += ` ORDER BY l.org_unit, l.date, l.entry_type, l.ai_vector_data, l.id DESC`;
            const query = `SELECT * FROM (${innerQuery}) d
                           ORDER BY d.real_date DESC, d.org_unit, d.display_time DESC
                           LIMIT ${ROW_LIMIT}`;

            const queryResult = await pool.query(query, params);
            const rows = (queryResult && queryResult.rows) || [];

            const typeLabel = (t) => {
                if (t === 'Attendance') return 'BÁO CÁO CA';
                if (t === 'Operation_Log') return 'NHẬT KÝ VẬN HÀNH';
                return t || 'KHÔNG RÕ LOẠI';
            };

            // [FIX] Báo cáo ca giờ đọc thẳng từ cột `content` (jsonb) thay vì chuỗi ai_vector_data.
            // Nhờ vậy AI thấy được cả sự cố thiết bị "khác" và tình trạng vệ sinh — hai trường
            // mà chuỗi ai_vector_data do frontend ghép sẵn không bao giờ chứa.
            //
            // [FIX] NGÂN SÁCH KÝ TỰ. Câu hỏi cả tháng cho 6 cơ sở nặng ~280.000 ký tự nhật ký.
            // Cắt cứng theo số dòng sẽ chặt mất nguyên nửa đầu tháng mà không ai biết. Nay:
            //  - BÁO CÁO CA luôn giữ đủ (chỉ ~270 dòng/tháng, ngắn, và là nơi ghi ai nghỉ);
            //  - NHẬT KÝ VẬN HÀNH (dài, chiếm ~90% dung lượng) mới bị cắt, cắt từ ngày CŨ NHẤT
            //    trở lui, và phải khai báo rõ đã cắt từ ngày nào để AI không kết luận "không có".
            const CHAR_BUDGET = 150000;
            let usedChars = 0;
            let droppedOpLogs = 0;
            let oldestOpLogKept = null;

            const resultLines = [];
            for (const r of rows) {
                const head = `[CƠ SỞ: ${r.facility_name}] [${typeLabel(r.entry_type)}] [${r.date}${r.display_time ? ' ' + r.display_time : ''}]`;
                let line = null;
                if (r.entry_type === 'Attendance' && isUsableAttendanceContent(r.content)) {
                    line = `${head} ${buildAttendanceDetail(r.content)}`;
                } else if (r.ai_vector_data && r.ai_vector_data.trim() !== '') {
                    line = `${head} ${r.ai_vector_data}`;
                }
                if (!line) continue;

                if (r.entry_type !== 'Attendance') {
                    if (usedChars + line.length > CHAR_BUDGET) { droppedOpLogs++; continue; }
                    oldestOpLogKept = r.date;
                }
                usedChars += line.length;
                resultLines.push(line);
            }

            const budgetWarn = droppedOpLogs > 0
                ? `\n\n[CẢNH BÁO CẮT DỮ LIỆU] Khoảng hỏi quá dài: ${droppedOpLogs} dòng NHẬT KÝ VẬN HÀNH cũ nhất KHÔNG được nạp.`
                    + ` Nhật ký vận hành chỉ đầy đủ từ ngày ${oldestOpLogKept || effectiveStart} trở về sau (toàn bộ BÁO CÁO CA vẫn được nạp đủ cả kỳ).`
                    + ` Với những ngày trước ${oldestOpLogKept || effectiveStart}, CẤM kết luận "không có nhật ký" hay "không ghi nhận nhân sự" — phải nói rõ là dữ liệu chưa được nạp.`
                : '';

            // ------------------------------------------------------------------
            // [MỚI] BỐI CẢNH NGHỈ TRƯỚC KỲ
            // Lý do: cửa sổ dữ liệu bị cắt cứng theo câu hỏi. Nếu một người đã nghỉ
            // từ TRƯỚC ngày bắt đầu cửa sổ, AI đọc ngày đầu cửa sổ thành ngày bắt đầu
            // nghỉ (thực tế: KTV 219 nghỉ từ 19/07 nhưng cửa sổ 24-30/07 khiến AI kết
            // luận "nghỉ 3 ngày rồi quay lại"). Nạp thêm 14 ngày báo cáo ca phía trước,
            // gắn nhãn rõ là NGOÀI kỳ để AI biết chuỗi nghỉ bắt đầu từ bao giờ.
            // ------------------------------------------------------------------
            const LOOKBACK_DAYS = 14;
            const MAX_LOOKBACK_LINES = 60;
            let lookbackBlock = '';

            if (entry_type !== 'Operation_Log') {
                try {
                    let lbInner = `
                        SELECT DISTINCT ON (l.org_unit, l.date, l.ai_vector_data)
                               l.org_unit, l.date, l.content,
                               TO_DATE(l.date, 'DD/MM/YYYY') AS real_date,
                               COALESCE(f.name, 'KHÔNG XÁC ĐỊNH') AS facility_name
                        FROM daily_logs l
                        LEFT JOIN facilities f ON f.id::text = l.org_unit::text
                        WHERE l.entry_type = 'Attendance'
                          AND TO_DATE(l.date, 'DD/MM/YYYY') < TO_DATE($1, 'DD/MM/YYYY')
                          AND TO_DATE(l.date, 'DD/MM/YYYY') >= TO_DATE($1, 'DD/MM/YYYY') - ${LOOKBACK_DAYS}
                    `;
                    const lbParams = [effectiveStart];
                    if (Array.isArray(scope.ids)) {
                        lbParams.push(scope.ids);
                        lbInner += ` AND l.org_unit::text = ANY($${lbParams.length}::text[])`;
                    }
                    lbInner += ` ORDER BY l.org_unit, l.date, l.ai_vector_data, l.id DESC`;

                    const lbResult = await pool.query(
                        `SELECT * FROM (${lbInner}) d ORDER BY d.real_date DESC, d.org_unit LIMIT 300`,
                        lbParams
                    );
                    const lbRows = (lbResult && lbResult.rows) || [];

                    // Chỉ giữ những ca THỰC SỰ có người nghỉ — ca ghi 0 người nghỉ không nói lên
                    // điều gì về chuỗi nghỉ và chỉ làm phình context.
                    const lbLines = [];
                    let lbTruncated = false;
                    for (const r of lbRows) {
                        if (!isUsableAttendanceContent(r.content)) continue;
                        const total = Number(r.content.manual_auth || 0) + Number(r.content.manual_unauth || 0);
                        if (total <= 0) continue;
                        if (lbLines.length >= MAX_LOOKBACK_LINES) { lbTruncated = true; break; }
                        const shift = r.content.shift ? ` [${r.content.shift}]` : '';
                        lbLines.push(`[CƠ SỞ: ${r.facility_name}] [${r.date}]${shift} ${buildLeaveSegment(r.content)}`);
                    }

                    if (lbLines.length > 0) {
                        lookbackBlock = `\n\n[BỐI CẢNH NGHỈ TRƯỚC KỲ — ${LOOKBACK_DAYS} ngày ngay trước ${effectiveStart}, NẰM NGOÀI khoảng đang hỏi]\n`
                            + `(Khối này CHỈ dùng để biết một người đã nghỉ từ trước hay chưa. TUYỆT ĐỐI KHÔNG cộng những ngày này vào thống kê của kỳ đang hỏi và KHÔNG đưa vào bảng báo cáo.)\n`
                            + lbLines.join('\n')
                            + (lbTruncated
                                ? `\n(Chỉ hiển thị ${MAX_LOOKBACK_LINES} ca gần ${effectiveStart} nhất — các ngày xa hơn chưa được nạp, không kết luận là "không ai nghỉ" cho những ngày đó.)`
                                : '');
                    }
                } catch (lbErr) {
                    // Bối cảnh trước kỳ là phần bổ trợ — hỏng thì bỏ qua, không được làm chết luồng chính
                    console.error('[AI Service] Lỗi nạp bối cảnh nghỉ trước kỳ:', lbErr.message);
                }
            }

            // Ranh giới cửa sổ: đặt ở CUỐI khối để AI đọc thấy ngay trước khi kết luận
            const boundaryNote = `\n\n[RANH GIỚI DỮ LIỆU] Nhật ký chi tiết chỉ được nạp từ ${effectiveStart} đến ${effectiveEnd}.`
                + ` Nếu một chuỗi ngày nghỉ chạm mép ${effectiveStart} hoặc ${effectiveEnd} thì KHÔNG được kết luận đó là ngày bắt đầu hoặc ngày kết thúc nghỉ`
                + ` — phải nói rõ "chuỗi có thể kéo dài ra ngoài khoảng đang xem".`;

            if (resultLines.length === 0) {
                const emptyMsg = rows.length === 0
                    ? `KHÔNG CÓ BẢN GHI NÀO trong khoảng ${effectiveStart} → ${effectiveEnd}.`
                    : `Có ${rows.length} bản ghi trong khoảng ${effectiveStart} → ${effectiveEnd} nhưng tất cả đều RỖNG NỘI DUNG.`;
                return emptyMsg + lookbackBlock + boundaryNote;
            }

            const truncatedWarn = rows.length >= ROW_LIMIT
                ? `\n[CẢNH BÁO] Dữ liệu đã bị cắt ở ${ROW_LIMIT} bản ghi gần nhất — các ngày cũ hơn trong khoảng này CHƯA được nạp. Không được kết luận là "không có dữ liệu" cho những ngày đó.`
                : '';

            return `[NHẬT KÝ VẬN HÀNH & BÁO CÁO CA — khoảng ${effectiveStart} → ${effectiveEnd}]\n`
                + `(Mỗi dòng đã ghi rõ CƠ SỞ và LOẠI bản ghi. Tuyệt đối không gán dòng của cơ sở này cho cơ sở khác.)\n`
                + resultLines.join('\n') + truncatedWarn + budgetWarn + lookbackBlock + boundaryNote;
        }

        if (functionName === 'fetch_kpi_analysis') {
            try {
                const now = new Date();
                const targetMonth = (functionArgs && functionArgs.month) ? Number(functionArgs.month) : (now.getMonth() + 1);
                const targetYear = (functionArgs && functionArgs.year) ? Number(functionArgs.year) : now.getFullYear();
                const applyMonthStr = `${targetMonth}/${targetYear}`;

                // 1. Lấy KPI settings theo tháng
                const kpiRes = await pool.query(
                    'SELECT data FROM kpi_settings WHERE apply_month = $1 LIMIT 1',
                    [applyMonthStr]
                );

                if (!kpiRes.rows || kpiRes.rows.length === 0) {
                    return `Hệ thống báo cáo: Chưa có cấu hình KPI cho tháng ${applyMonthStr}. Vui lòng yêu cầu bộ phận phụ trách thiết lập chỉ tiêu.`;
                }

                const kpiData = typeof kpiRes.rows[0].data === 'string'
                    ? JSON.parse(kpiRes.rows[0].data)
                    : kpiRes.rows[0].data;

                // 2. Phân quyền: Lãnh đạo thấy tất cả, quản lý cơ sở chỉ thấy của mình
                const isGlobal = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(userContext.role);
                const userFacilityId = userContext.facility_id ? String(userContext.facility_id) : null;

                // Lọc danh sách cơ sở được phép xem
                const allowedFacilities = Object.values(kpiData).filter(fac => {
                    if (isGlobal) return true;
                    return String(fac.facility_id) === userFacilityId;
                });

                if (allowedFacilities.length === 0) {
                    return `Hệ thống báo cáo: Không tìm thấy dữ liệu KPI phù hợp với cơ sở của bạn trong tháng ${applyMonthStr}.`;
                }

                // 3. Lấy doanh thu thực tế cùng tháng
                const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
                const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
                // [FIX] Cùng lỗi `LIMIT 500` như fetch_revenue_summary: lọc thẳng theo ngày trong SQL.
                // (Hàm fmtISO cũ dùng toISOString() — quy đổi sang UTC nên lệch 1 ngày ở múi giờ dương;
                //  nó vốn là code chết, nay thay bằng bộ định dạng theo giờ địa phương và dùng thật.)
                const fmtSqlDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                const revRes = await pool.query(
                    'SELECT * FROM daily_financial_reports WHERE date >= $1 AND date <= $2 ORDER BY date DESC',
                    [fmtSqlDate(startOfMonth), fmtSqlDate(endOfMonth)]
                );
                const allReports = revRes.rows;

                // Tính doanh thu thực tế theo từng cơ sở trong tháng
                const revenueByFacility = {};
                const timeFiltered = allReports.filter(r => {
                    if (!r.date) return false;
                    const parts = r.date.split('-');
                    const rDate = new Date(parts[0], parts[1] - 1, parts[2]);
                    return rDate >= startOfMonth && rDate <= endOfMonth;
                });

                timeFiltered.forEach(r => {
                    const rData = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                    if (rData && Array.isArray(rData)) {
                        rData.forEach(facData => {
                            const key = String(facData.id || facData.name || '');
                            if (!revenueByFacility[key]) revenueByFacility[key] = 0;
                            revenueByFacility[key] += Number(facData.revenue || 0);
                            // Cũng index theo tên để ghép dễ hơn
                            const nameKey = String(facData.name || '');
                            if (nameKey && nameKey !== key) {
                                if (!revenueByFacility[nameKey]) revenueByFacility[nameKey] = 0;
                                revenueByFacility[nameKey] += Number(facData.revenue || 0);
                            }
                        });
                    }
                });

                // 4. Tính toán số ngày trong tháng, ngày đã qua, ngày còn lại
                const totalDaysInMonth = new Date(targetYear, targetMonth, 0).getDate();
                const todayDate = now.getDate();
                const currentMonthCheck = (now.getMonth() + 1 === targetMonth && now.getFullYear() === targetYear);
                const daysPassed = currentMonthCheck ? Math.min(todayDate, totalDaysInMonth) : totalDaysInMonth;
                const daysRemaining = currentMonthCheck ? Math.max(totalDaysInMonth - todayDate, 0) : 0;

                // Đếm ngày thường và cuối tuần trong tháng
                let weekdayCount = 0;
                let weekendCount = 0;
                for (let d = 1; d <= totalDaysInMonth; d++) {
                    const dow = new Date(targetYear, targetMonth - 1, d).getDay();
                    if (dow === 0 || dow === 6) weekendCount++;
                    else weekdayCount++;
                }

                // 5. Tổng hợp phân tích
                const resultLines = [`[PHÂN TÍCH KPI DOANH THU THÁNG ${applyMonthStr}]`,
                    `Tổng số ngày trong tháng: ${totalDaysInMonth} (Ngày thường: ${weekdayCount} | Cuối tuần: ${weekendCount})`,
                    `Ngày đã qua: ${daysPassed} | Ngày còn lại: ${daysRemaining}`,
                    `---`
                ];

                for (const fac of allowedFacilities) {
                    const facName = fac.name || `Cơ sở ${fac.facility_id}`;
                    const weekdayTarget = Number(fac.weekday_target || 0);
                    const weekendTarget = Number(fac.weekend_target || 0);

                    // Ước tính KPI tháng = (weekday_target * số ngày thường) + (weekend_target * số ngày cuối tuần)
                    const monthlyKpiEstimate = (weekdayTarget * weekdayCount) + (weekendTarget * weekendCount);

                    // Doanh thu thực tế (thử ghép theo id rồi fallback theo tên)
                    const actualRevenue = revenueByFacility[String(fac.facility_id)] ||
                        revenueByFacility[facName] || 0;

                    const completionPct = monthlyKpiEstimate > 0
                        ? ((actualRevenue / monthlyKpiEstimate) * 100).toFixed(1)
                        : 'N/A';

                    const avgPerDayActual = daysPassed > 0 ? Math.round(actualRevenue / daysPassed) : 0;
                    const remainingKpi = Math.max(monthlyKpiEstimate - actualRevenue, 0);
                    const neededPerDay = daysRemaining > 0 ? Math.round(remainingKpi / daysRemaining) : null;

                    // Đánh giá trạng thái
                    let status = '';
                    let statusEmoji = '';
                    const pct = parseFloat(completionPct);
                    if (completionPct === 'N/A') {
                        status = 'KHÔNG CÓ DỮ LIỆU KPI';
                        statusEmoji = '⚪';
                    } else if (!currentMonthCheck) {
                        // Tháng đã qua — đánh giá kết quả cuối
                        if (pct >= 100) { status = 'ĐẠT KPI'; statusEmoji = '✅'; }
                        else if (pct >= 85) { status = 'GẦN ĐẠT KPI'; statusEmoji = '🟡'; }
                        else { status = 'KHÔNG ĐẠT KPI'; statusEmoji = '🔴'; }
                    } else {
                        // Tháng hiện tại — dự báo
                        const projectedRevenue = daysPassed > 0 ? Math.round((actualRevenue / daysPassed) * totalDaysInMonth) : 0;
                        const projectedPct = monthlyKpiEstimate > 0 ? ((projectedRevenue / monthlyKpiEstimate) * 100).toFixed(1) : 'N/A';
                        if (pct >= 100) { status = `ĐÃ VƯỢT KPI | Dự báo cuối tháng: ${projectedPct}%`; statusEmoji = '✅'; }
                        else if (neededPerDay && neededPerDay <= weekdayTarget) { status = `ĐANG THEO KỊP | Cần ${neededPerDay.toLocaleString('vi-VN')}/ngày còn lại`; statusEmoji = '🟢'; }
                        else if (neededPerDay && neededPerDay <= weekdayTarget * 1.3) { status = `CẦN CỐ GẮNG | Cần ${neededPerDay.toLocaleString('vi-VN')}/ngày còn lại`; statusEmoji = '🟡'; }
                        else { status = `NGUY HIỂM — DƯỚI CHỈ TIÊU | Cần ${neededPerDay ? neededPerDay.toLocaleString('vi-VN') : 'N/A'}/ngày còn lại`; statusEmoji = '🔴'; }
                    }

                    resultLines.push(`\n${statusEmoji} ${facName}`);
                    resultLines.push(`  Chỉ tiêu/ngày: Ngày thường ${weekdayTarget.toLocaleString('vi-VN')} | Cuối tuần ${weekendTarget.toLocaleString('vi-VN')}`);
                    resultLines.push(`  KPI ước tính cả tháng: ${monthlyKpiEstimate.toLocaleString('vi-VN')} VNĐ`);
                    resultLines.push(`  Doanh thu thực tế: ${actualRevenue.toLocaleString('vi-VN')} VNĐ (${completionPct}% KPI)`);
                    resultLines.push(`  Tốc độ TB hiện tại: ${avgPerDayActual.toLocaleString('vi-VN')}/ngày`);
                    resultLines.push(`  Trạng thái: ${status}`);
                }

                resultLines.push(`\n---`);
                resultLines.push(`[LƯU Ý CHO AI] Dựa vào số liệu trên, hãy phân tích sâu và đề xuất phương án kinh doanh cụ thể cho từng cơ sở: tăng ca, điều chỉnh dịch vụ, khuyến mãi, điều phối nhân sự hoặc các giải pháp vận hành phù hợp. Không được chỉ đọc số — phải đưa ra hành động.`);

                return resultLines.join('\n');
            } catch (e) {
                console.error('Lỗi fetch_kpi_analysis:', e);
                return 'Hệ thống gặp lỗi khi phân tích KPI. Vui lòng thử lại.';
            }
        }

        return "Hệ thống từ chối: Tool không được hỗ trợ.";
    } catch (error) {
        console.error('[AI Service Error - processToolCall]:', error.message);
        return "Hệ thống không tìm thấy dữ liệu. Hãy báo người dùng thử lại sau.";
    }
};

module.exports = {
    AI_TOOLS,
    processToolCall,
    resolveFacilityScope,
    resolveAllowedFacilityIds
};
