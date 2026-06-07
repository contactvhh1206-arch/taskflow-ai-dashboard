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

            // TINH GỌN RAG: Bổ sung các trường sinh tử
            const simplifiedData = rows.map(t => {
                const assignee = t.assignee_name || t.pic || "Chưa giao";
                const dueDate = t.deadline ? new Date(t.deadline).toLocaleDateString('vi-VN') : "Không có";
                const isUrgent = t.urgent ? "[KHẨN]" : "";
                return `[ID: ${t.id}] ${isUrgent} ${t.title} - Status: ${t.status} - Phụ trách: ${assignee} - Hạn chót: ${dueDate}`;
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
                    startDate = new Date(targetYear, 0, 1);
                    endDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
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

                let resultStr = `[TỔNG DOANH THU THÁNG ${month ? month + '/' + targetYear : targetYear}]\n`;
                for (const fac of Object.values(aggregated)) {
                    if (fac.revenue > 0) {
                        resultStr += `- Cơ sở: ${fac.name} | TỔNG DOANH THU: ${fac.revenue} VNĐ\n`;
                    }
                }
                
                if (resultStr === `[TỔNG DOANH THU THÁNG ${month ? month + '/' + targetYear : targetYear}]\n`) {
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
