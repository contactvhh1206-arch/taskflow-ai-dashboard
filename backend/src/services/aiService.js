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
            description: "Lấy báo cáo doanh thu, chi phí của các cơ sở. Dùng khi User hỏi về doanh thu, tài chính, báo cáo ngày/tháng.",
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

        if (functionName === 'fetch_financial_reports') {
            const { start_date, end_date, limit } = functionArgs || {};
            const queryLimit = limit ? Math.min(limit, 1000) : 500;
            
            const query = `
                WITH RecentDates AS (
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
                WHERE ($1::text[] IS NULL OR elem->>'id' = ANY($1::text[]))
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
