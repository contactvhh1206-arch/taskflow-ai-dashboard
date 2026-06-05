const taskService = require('./taskService');
const pool = require('../config/database');

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
                    }
                },
                additionalProperties: false
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
                    month: {
                        type: "number",
                        description: "Tháng cần lấy báo cáo (1-12)"
                    },
                    year: {
                        type: "number",
                        description: "Năm cần lấy báo cáo"
                    }
                },
                additionalProperties: false
            }
        }
    }
];

// 2. Bộ xử lý Lệnh Tool (Cơ chế Sandbox Tiêm ngầm)
const processToolCall = async (functionName, functionArgs, userContext) => {
    try {
        if (functionName === 'fetch_kanban_tasks') {
            
            // TIÊM NGẦM BẮT BUỘC: Không cho AI tự quyết định cơ sở, ép dùng của User
            const args = {
                ...functionArgs,
                userId: userContext.id,
                role: userContext.role,
                facilityId: userContext.facility_id,
                departmentCode: userContext.department_code,
                limit: 5 // ĐIỀU KHOẢN RAG: Ép cứng limit 5 để chống cạn kiệt Token Context
            };

            const { rows } = await taskService.getTasksList(args);
            
            if (!rows || rows.length === 0) {
                return "Hệ thống báo cáo: Không có công việc nào thỏa mãn điều kiện.";
            }

            // TINH GỌN RAG: Lọc rác hiển thị, chỉ nạp dữ liệu sống còn cho AI đọc
            const simplifiedData = rows.map(t => `[ID: ${t.id}] ${t.title} - Status: ${t.status}`).join('\n');
            return simplifiedData;
        }

        if (functionName === 'fetch_financial_reports') {
            const { month, year } = functionArgs || {};
            
            const query = `
                SELECT date, elem->>'revenue' AS revenue_amount, elem->>'name' AS facility_name
                FROM daily_financial_reports, 
                     jsonb_array_elements(CASE WHEN jsonb_typeof(data::jsonb) = 'array' THEN data::jsonb ELSE '[]'::jsonb END) AS elem
                WHERE ($1::text IS NULL OR elem->>'id' = $1::text)
                ORDER BY created_at DESC 
                LIMIT 30;
            `;
            
            // Xử lý lãnh đạo vs quản lý cơ sở
            const facilityParam = (userContext.role === 'SUPER_ADMIN' || userContext.role === 'VICE_PRESIDENT' || userContext.role === 'ADMIN' || userContext.facility_id === 'ALL') 
                ? null 
                : userContext.facility_id;
                
            const { rows } = await pool.query(query, [facilityParam]);

            if (!rows || rows.length === 0) {
                return "Hệ thống báo cáo: Không có dữ liệu doanh thu.";
            }

            let resultLines = [];
            for (const r of rows) {
                // Lọc theo month/year nếu AI yêu cầu
                if (month || year) {
                    const rDate = new Date(r.date);
                    if (month && rDate.getMonth() + 1 !== month) continue;
                    if (year && rDate.getFullYear() !== year) continue;
                }
                
                resultLines.push(`[Cơ sở: ${r.facility_name}] Ngày: ${r.date} - Doanh thu: ${r.revenue_amount || 0} VNĐ`);
            }

            if (resultLines.length === 0) {
                return "Hệ thống báo cáo: Không có dữ liệu doanh thu cho khoảng thời gian này.";
            }

            return resultLines.join('\n');
        }

        return "Hệ thống từ chối: Tool không được hỗ trợ.";
    } catch (error) {
        console.error('[AI Service Error - processToolCall]:', error.message);
        return "Lỗi máy chủ khi truy xuất dữ liệu Tool.";
    }
};

module.exports = {
    AI_TOOLS,
    processToolCall
};
