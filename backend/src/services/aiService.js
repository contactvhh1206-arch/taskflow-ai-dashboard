const pool = require('../config/database');
const taskService = require('./taskService');

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
                
                const repRes = await pool.query('SELECT * FROM daily_financial_reports ORDER BY created_at DESC LIMIT 500');
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

                const displayMonth = month || (new Date().getMonth() + 1);
                let resultStr = `[TỔNG DOANH THU THÁNG ${displayMonth}/${targetYear}]\n`;
                for (const fac of Object.values(aggregated)) {
                    if (fac.revenue > 0) {
                        resultStr += `- Cơ sở: ${fac.name} | TỔNG DOANH THU: ${fac.revenue} VNĐ\n`;
                    }
                }
                
                if (resultStr === `[TỔNG DOANH THU THÁNG ${displayMonth}/${targetYear}]\n`) {
                    return "Hệ thống không có dữ liệu doanh thu cho thời gian này.";
                }
                return resultStr;
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

            // Tự động tính tổng kỳ bằng Javascript
            const summary = {};
            for (const r of rows) {
                if (!summary[r.facility_name]) summary[r.facility_name] = 0;
                summary[r.facility_name] += Number(r.revenue_amount || 0);
            }

            let resultLines = ["=== TỔNG DOANH THU TRONG KỲ (AI HÃY ƯU TIÊN DÙNG SỐ NÀY ĐỂ BÁO CÁO) ==="];
            for (const [fac, total] of Object.entries(summary)) {
                resultLines.push(`- Cơ sở: ${fac} | TỔNG DOANH THU: ${total} VNĐ`);
            }
            resultLines.push("======================================================================");
            resultLines.push("=== CHI TIẾT DOANH THU TỪNG NGÀY ===");

            for (const r of rows) {
                resultLines.push(`[Cơ sở: ${r.facility_name}] Ngày: ${r.formatted_date} - Doanh thu: ${r.revenue_amount || 0} VNĐ`);
            }

            return resultLines.join('\n');
        }

        if (functionName === 'fetch_daily_logs') {
            const { start_date, end_date, entry_type } = functionArgs || {};

            // Phân quyền: Global roles thấy tất cả, còn lại chỉ thấy cơ sở của mình
            const isGlobal = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(userContext.role);

            // Mặc định lấy 3 ngày gần nhất nếu không truyền start_date
            // Định dạng ngày DD/MM/YYYY cho khớp với dữ liệu thực tế trong cột date của bảng daily_logs
            const defaultStart = new Date();
            defaultStart.setDate(defaultStart.getDate() - 3);
            const fmt = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            const effectiveStart = start_date || fmt(defaultStart);
            const effectiveEnd = end_date || fmt(new Date());

            let query = `
                SELECT org_unit, entry_type, date, display_time, ai_vector_data
                FROM daily_logs
                WHERE TO_DATE(date, 'DD/MM/YYYY') >= TO_DATE($1, 'DD/MM/YYYY')
                  AND TO_DATE(date, 'DD/MM/YYYY') <= TO_DATE($2, 'DD/MM/YYYY')
            `;
            const params = [effectiveStart, effectiveEnd];

            if (!isGlobal && userContext.facility_id) {
                params.push(String(userContext.facility_id));
                query += ` AND org_unit = $${params.length}`;
            }

            if (entry_type) {
                params.push(entry_type);
                query += ` AND entry_type = $${params.length}`;
            }

            query += ` ORDER BY date DESC, display_time DESC LIMIT 200`;

            const { rows } = await pool.query(query, params);

            if (!rows || rows.length === 0) {
                return `Không có dữ liệu nhật ký/báo cáo ca trong khoảng ${effectiveStart} → ${effectiveEnd}.`;
            }

            const resultLines = rows
                .filter(r => r.ai_vector_data && r.ai_vector_data.trim() !== '')
                .map(r => `[${r.date}] ${r.ai_vector_data}`);

            if (resultLines.length === 0) {
                return `Có bản ghi nhưng trường ai_vector_data rỗng trong khoảng ${effectiveStart} → ${effectiveEnd}.`;
            }

            return `[NHẬT KÝ VẬN HÀNH & BÁO CÁO CA (${effectiveStart} → ${effectiveEnd})]:\n` + resultLines.join('\n');
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
                const fmtISO = (d) => d.toISOString().split('T')[0];

                const revRes = await pool.query(
                    'SELECT * FROM daily_financial_reports ORDER BY created_at DESC LIMIT 500'
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
    processToolCall
};
