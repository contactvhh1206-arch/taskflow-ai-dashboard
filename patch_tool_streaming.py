import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Add normalizeDeptCode and executeCreateTaskTool before detectAndLearnRule
functions_code = """
// ==============================================================================
// BƯỚC 2.1: HÀM CHUẨN HÓA MÃ PHÒNG BAN (NÂNG CẤP XÓA DẤU TIẾNG VIỆT)
// ==============================================================================
function normalizeDeptCode(rawCode) {
    if (!rawCode) return null;
    
    // Loại bỏ dấu Tiếng Việt và đưa về in hoa
    const normalized = rawCode.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim();
    
    const map = {
        'TRUYEN THONG': 'MARKETING',
        'MKT': 'MARKETING',
        'KE TOAN': 'FINANCE',
        'TCKT': 'FINANCE',
        'KY THUAT': 'TECHNICAL',
        'IT': 'TECHNICAL',
        'NHAN SU': 'HR',
        'HCNS': 'HR',
        'BAN GIAM DOC': 'BGD'
    };
    
    // Nếu có trong từ điển thì lấy, không thì giữ nguyên các ký tự chữ/số và gạch dưới
    return map[normalized] || normalized.replace(/[^A-Z0-9]/g, '_');
}

// ==============================================================================
// BƯỚC 2.2 & 2.3: HÀM THỰC THI CHÍNH (CHUẨN RBAC & DATA INTEGRITY)
// ==============================================================================
async function executeCreateTaskTool(args, user) {
    const { title, department_code, deadline, priority } = args;
    
    const normalizedDept = normalizeDeptCode(department_code);
    if (!normalizedDept) {
        throw new Error("Lỗi: Mã phòng ban/cơ sở không hợp lệ hoặc bị trống.");
    }

    // 1. RBAC Guardrail: Tái sử dụng logic chuẩn từ RAG
    const isAllAccess = 
        user.role === 'SUPER_ADMIN' || 
        user.role === 'VICE_PRESIDENT' || 
        (user.role === 'DEPARTMENT_HEAD' && user.department_code === 'MARKETING');

    if (!isAllAccess) {
        const userDept = normalizeDeptCode(user.department_code || user.facility_code || '');
        if (normalizedDept !== userDept) {
            throw new Error(`AI TỪ CHỐI: Bạn không có quyền tạo task cho phòng ban [${normalizedDept}]. Thẩm quyền của bạn giới hạn tại: [${userDept}].`);
        }
    }

    // 2. Validate Deadline chống Crash DB
    let deadlineVal = null;
    if (deadline) {
        const parsedDate = new Date(deadline);
        if (isNaN(parsedDate.getTime())) {
            throw new Error(`Lỗi: AI truyền định dạng ngày tháng không hợp lệ (${deadline}). Yêu cầu định dạng YYYY-MM-DD.`);
        }
        deadlineVal = parsedDate;
    }

    // 3. Xử lý logic Facility ID thông minh (Không Hardcode)
    let finalFacilityId = user.facility_id;
    
    // Nếu All-Access user tạo task cho cơ sở khác, tự động tra cứu ID của cơ sở đó
    if (isAllAccess && normalizedDept !== normalizeDeptCode(user.department_code)) {
        const { rows } = await pool.query(`SELECT id FROM facilities WHERE code = $1 LIMIT 1`, [normalizedDept]);
        if (rows.length > 0) {
            finalFacilityId = rows[0].id;
        } else {
            // Fallback nếu không tìm thấy, ép dùng facility_id của người tạo (hoặc ném lỗi tùy logic PO)
            finalFacilityId = user.facility_id; 
        }
    }

    const priorityLevel = priority || 'MEDIUM';

    // 4. Thực thi Database Insert
    const insertQuery = `
        INSERT INTO tasks (title, department_code, deadline, priority_level, created_by, facility_id) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id;
    `;
    
    try {
        const result = await pool.query(insertQuery, [
            title, normalizedDept, deadlineVal, priorityLevel, user.id, finalFacilityId
        ]);
        
        return {
            status: "success",
            message: `Tạo công việc thành công. ID: ${result.rows[0].id}`
        };
    } catch (error) {
        console.error("Database Error (executeCreateTaskTool):", error);
        throw new Error("Lỗi hệ thống khi lưu công việc vào cơ sở dữ liệu.");
    }
}

"""

if "function normalizeDeptCode" not in text:
    text = text.replace("async function detectAndLearnRule", functions_code + "async function detectAndLearnRule")


# 2. Refactor app.post('/api/ai/chat') to use tools
import re

# We will replace from `        // ==========================================\n        // NHỊP 3: SSE STREAMING` up to `res.write(\`data: [DONE]`

new_streaming_logic = """
        // ==========================================
        // NHỊP 3: SSE STREAMING VỚI TOOL CALL
        // ==========================================
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const tools = [
            {
                type: "function",
                function: {
                    name: "create_system_task",
                    description: "Tạo hoặc giao một công việc mới cho phòng ban/cơ sở trên hệ thống.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Tiêu đề công việc" },
                            department_code: { type: "string", description: "Tên phòng ban (VD: Truyền thông, Kế toán, DB41)" },
                            deadline: { type: "string", description: "Hạn chót (ISO format hoặc text)" },
                            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }
                        },
                        required: ["title", "department_code"]
                    }
                }
            }
        ];

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini", // Tuỳ chỉnh model theo config của bạn
                messages: messages,
                stream: true,
                tools: tools,
                stream_options: { include_usage: true }
            })
        });

        if (!response.ok) {
            console.error("OpenRouter Stream Error:", await response.text());
            res.write(`data: ${JSON.stringify({ error: "Lỗi kết nối AI API" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            return res.end();
        }

        let reader = response.body.getReader();
        let decoder = new TextDecoder("utf-8");
        let aiReplyContent = "";
        let promptTokens = 0; 
        let completionTokens = 0;

        let toolCallId = null;
        let toolCallName = null;
        let toolCallArguments = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split(String.fromCharCode(10));
            
            for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                    try {
                        const parsed = JSON.parse(line.substring(6));
                        
                        if (parsed.usage) {
                            promptTokens += parsed.usage.prompt_tokens || 0;
                            completionTokens += parsed.usage.completion_tokens || 0;
                        }

                        if (parsed.choices && parsed.choices.length > 0) {
                            const delta = parsed.choices[0].delta;
                            
                            // 1. Hứng Tool Call
                            if (delta && delta.tool_calls) {
                                const tc = delta.tool_calls[0];
                                if (tc.id) toolCallId = tc.id;
                                if (tc.function && tc.function.name) toolCallName = tc.function.name;
                                if (tc.function && tc.function.arguments) toolCallArguments += tc.function.arguments;
                            }
                            
                            // 2. Hứng Text bình thường
                            if (delta && delta.content) {
                                aiReplyContent += delta.content;
                                res.write(`data: ${JSON.stringify({ content: delta.content })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                            }
                        }
                    } catch (e) {
                        console.error("Lỗi parse JSON stream chunk:", e);
                    }
                }
            }
        }

        // ==========================================
        // NHỊP 3.5: THỰC THI TOOL VÀ GỌI LẠI AI (LẦN 2)
        // ==========================================
        if (toolCallName === "create_system_task" && toolCallArguments) {
            let toolResultStr;
            try {
                const args = JSON.parse(toolCallArguments);
                const result = await executeCreateTaskTool(args, req.user);
                toolResultStr = JSON.stringify(result);
            } catch (err) {
                toolResultStr = JSON.stringify({ status: "error", message: err.message });
            }
            
            // Cập nhật messages array để gọi lại AI
            messages.push({
                role: "assistant",
                content: null,
                tool_calls: [{
                    id: toolCallId || "call_generated",
                    type: "function",
                    function: { name: toolCallName, arguments: toolCallArguments }
                }]
            });
            messages.push({
                role: "tool",
                tool_call_id: toolCallId || "call_generated",
                name: toolCallName,
                content: toolResultStr
            });

            // Gọi AI lần 2 để stream câu trả lời về frontend
            const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                    "Content-Type": "application/json" 
                },
                body: JSON.stringify({
                    model: "openai/gpt-4o-mini",
                    messages: messages,
                    stream: true,
                    stream_options: { include_usage: true }
                })
            });

            if (response2.ok) {
                reader = response2.body.getReader();
                decoder = new TextDecoder("utf-8");
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split(String.fromCharCode(10));
                    
                    for (const line of lines) {
                        if (line.startsWith("data: ") && line !== "data: [DONE]") {
                            try {
                                const parsed = JSON.parse(line.substring(6));
                                if (parsed.usage) {
                                    promptTokens += parsed.usage.prompt_tokens || 0;
                                    completionTokens += parsed.usage.completion_tokens || 0;
                                }
                                if (parsed.choices && parsed.choices.length > 0) {
                                    const contentChunk = parsed.choices[0].delta?.content || "";
                                    if (contentChunk) {
                                        aiReplyContent += contentChunk;
                                        res.write(`data: ${JSON.stringify({ content: contentChunk })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                }
            }
        }

"""

pattern = r"// ==========================================\s*// NHỊP 3: SSE STREAMING\s*// ==========================================.*?res\.write\(`data: \[DONE\]"

text = re.sub(pattern, new_streaming_logic + "        res.write(`data: [DONE]", text, flags=re.DOTALL)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("server.js successfully patched!")
