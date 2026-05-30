import sys, re

with open('server.js', 'r', encoding='utf-8') as f:
    code = f.read()

get_ai_perms = r'''
// ==============================================================================
// TRUNG TÂM PHÂN QUYỀN AI (AI RBAC GUARDRAIL)
// ==============================================================================
function getAiPermissions(user) {
    if (!user || !user.role) {
        return { isGlobal: false, departmentCode: null, facilityId: null };
    }
    
    const role = user.role;
    const departmentCode = user.department_code || null;
    const facilityId = user.facility_id ? String(user.facility_id) : null;
    
    // Xác định quyền All-Access (Global)
    const isGlobal = role === 'SUPER_ADMIN' || 
                     role === 'VICE_PRESIDENT' || 
                     (role === 'DEPARTMENT_HEAD' && departmentCode === 'MARKETING');
                     
    return {
        isGlobal,
        departmentCode,
        facilityId
    };
}
'''

new_search = r'''
// ==============================================================================
// TẦNG RAG SEARCH KẾT HỢP RBAC FILTERING (VERSION 2 - CHUẨN KIẾN TRÚC)
// ==============================================================================
async function searchKnowledgeBase(queryText, user, limit = 3) {
    try {
        const perms = getAiPermissions(user);
        
        // 1. Kiểm tra an toàn cho nhóm Local (Soft Reject)
        if (!perms.isGlobal && !perms.departmentCode && !perms.facilityId) {
            console.warn(`[SECURITY ALERT] User ${user.id} thiếu cả department_code và facility_id.`);
            return [{ content: "Hệ thống từ chối: Tài khoản của bạn chưa được cấu hình phòng ban hoặc cơ sở để tra cứu tài liệu." }];
        }

        const queryEmbedding = await generateEmbedding(queryText);
        if (!queryEmbedding) return [{ content: "Hệ thống: Không thể khởi tạo vector cho câu truy vấn." }];
        
        const formatEmbedding = `[${queryEmbedding.join(',')}]`;

        let sql = "";
        let params = [];

        // 2. Tách nhánh Truy vấn với biến perms chuẩn hóa
        if (perms.isGlobal) {
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;
            params = [formatEmbedding, limit];
        } else {
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE (metadata @> '{"department_code": "GLOBAL"}'::jsonb)
                   OR ($3::text IS NOT NULL AND metadata @> jsonb_build_object('department_code', $3::text))
                   OR ($4::text IS NOT NULL AND metadata @> jsonb_build_object('facility_id', $4::text))
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;
            params = [formatEmbedding, limit, perms.departmentCode, perms.facilityId];
        }
        
        const { rows } = await pool.query(sql, params);
        return rows;
    } catch (error) {
        console.error('searchKnowledgeBase Error:', error);
        return [{ content: "Hệ thống từ chối: Đã xảy ra lỗi nội bộ khi tra cứu cơ sở tri thức." }];
    }
}
'''

new_rev = r'''
async function executeGetRevenueTool(args, user) {
    const { date_range, facility_code } = args;
    
    // 1. Áp dụng Hàm Trung Tâm Phân Quyền
    const perms = getAiPermissions(user);
    
    // 2. Cảnh báo và Chặn Quyền Xuyên Không (Cross-facility)
    if (!perms.isGlobal && facility_code && String(facility_code).toUpperCase().trim() !== String(perms.facilityId).toUpperCase().trim()) {
        console.warn(`[SECURITY ALERT] User ${user.id} (Facility ${perms.facilityId}) cố gắng truy cập doanh thu Facility ${facility_code}`);
        return { error: `Hệ thống từ chối: Tài khoản của bạn không đủ quyền tra cứu dữ liệu doanh thu của cơ sở chéo [${facility_code}].` };
    }

    const targetFacility = perms.isGlobal ? (facility_code ? String(facility_code) : null) : perms.facilityId;

    // ==============================================================
    // FALLBACK DATE LOGIC: MIỄN NHIỄM VỚI MỌI SAI SÓT TỪ USER/AI
    // ==============================================================
    let startDate, endDate;

    if (date_range && typeof date_range === 'object' && date_range.startDate && date_range.endDate) {
        startDate = date_range.startDate;
        endDate = date_range.endDate;
    } else if (typeof date_range === 'string' && date_range.includes('-')) {
        const parts = date_range.split('-');
        startDate = parts[0]?.trim();
        endDate = parts[1]?.trim() || startDate; 
    } else {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        
        const formatToISO = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        startDate = formatToISO(firstDay);
        endDate = formatToISO(today);
        console.warn(`[REVENUE TOOL] Missing date_range. Fallback to current month: ${startDate} -> ${endDate}`);
    }

    let sql = "";
    let params = [];

    if (!targetFacility) {
        sql = `SELECT COALESCE(SUM(total_revenue), 0) AS aggregated_revenue 
               FROM daily_financial_reports 
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= (CASE WHEN $1::text LIKE '%-%' THEN $1::date ELSE to_date($1::text, 'DD/MM/YYYY') END) 
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= (CASE WHEN $2::text LIKE '%-%' THEN $2::date ELSE to_date($2::text, 'DD/MM/YYYY') END)`;
        params = [startDate, endDate];
    } else {
        sql = `SELECT COALESCE(SUM((NULLIF(regexp_replace(item->>'revenue', '[^0-9]', '', 'g'), ''))::numeric), 0) + 
              COALESCE(SUM((NULLIF(regexp_replace(item->>'totalRevenue', '[^0-9]', '', 'g'), ''))::numeric), 0) AS aggregated_revenue
               FROM daily_financial_reports
               CROSS JOIN LATERAL jsonb_array_elements(
                   CASE 
                       WHEN jsonb_typeof(data) = 'array' THEN data 
                       WHEN jsonb_typeof(data->'facilities') = 'array' THEN data->'facilities' 
                       ELSE '[]'::jsonb 
                   END
               ) AS item
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= (CASE WHEN $1::text LIKE '%-%' THEN $1::date ELSE to_date($1::text, 'DD/MM/YYYY') END)
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= (CASE WHEN $2::text LIKE '%-%' THEN $2::date ELSE to_date($2::text, 'DD/MM/YYYY') END)
                 AND (REPLACE(UPPER(item->>'name'), ' ', '') = REPLACE(UPPER($3::text), ' ', '')
                      OR REPLACE(UPPER(item->>'facilityCode'), ' ', '') = REPLACE(UPPER($3::text), ' ', '')
                      OR REPLACE(UPPER(item->>'facilityName'), ' ', '') = REPLACE(UPPER($3::text), ' ', ''))`;
        params = [startDate, endDate, targetFacility];
    }
    
    try {
        const { rows } = await pool.query(sql, params);
        return {
            status: "success",
            message: `Báo cáo doanh thu của hệ thống/cơ sở [${targetFacility || 'Toàn hệ thống'}] từ ngày ${startDate} đến ${endDate} là: ${Number(rows[0].aggregated_revenue).toLocaleString('vi-VN')} VNĐ.`
        };
    } catch (error) {
        console.error("Revenue DB Error:", error);
        return { error: "Lỗi hệ thống khi trích xuất doanh thu từ cơ sở dữ liệu." };
    }
}
'''

# Replace searchKnowledgeBase
pattern_search = re.compile(r'// ==============================================================================\n// T.*?NG RAG SEARCH.*?async function searchKnowledgeBase.*?catch \(error\) \{\n\s*console\.error\(\'searchKnowledgeBase Error:\', error\);\n\s*throw error;\n\s*\}[\r\n]*\}', re.DOTALL)

match_search = pattern_search.search(code)
if match_search:
    code = code[:match_search.start()] + get_ai_perms + '\n' + new_search + code[match_search.end():]
    print('Replaced searchKnowledgeBase!')
else:
    print('Failed to find searchKnowledgeBase!')
    # Alternative pattern
    pat2 = re.compile(r'async function searchKnowledgeBase.*?return rows;\n\s*\} catch \(error\) \{.*?\throw error;\n\s*\}', re.DOTALL)
    m2 = pat2.search(code)
    if m2:
        # Find the comment block above it
        start_idx = code.rfind('// =================', 0, m2.start())
        if start_idx != -1:
            code = code[:start_idx] + get_ai_perms + '\n' + new_search + code[m2.end():]
            print('Replaced searchKnowledgeBase with alternative pattern!')

# Replace executeGetRevenueTool
pattern_rev = re.compile(r'async function executeGetRevenueTool\(args, user\).*?catch \(error\) \{\n\s*console\.error\("Database Error \(executeGetRevenueTool\):", error\);\n\s*throw new Error\("L.*?i h.*? th.*?ng khi tr.*?ch xu.*?t doanh thu."\);\n\s*\}[\r\n]*\}', re.DOTALL)

match_rev = pattern_rev.search(code)
if match_rev:
    code = code[:match_rev.start()] + new_rev + code[match_rev.end():]
    print('Replaced executeGetRevenueTool!')
else:
    print('Failed to find executeGetRevenueTool using first pattern, trying alternative!')
    # Alternate
    pat3 = re.compile(r'async function executeGetRevenueTool\(args, user\).*?throw new Error\("L.*?i h.*? th.*?ng khi tr.*?ch xu.*?t doanh thu.*?"\);\n\s*\}[\r\n]*\}', re.DOTALL)
    m3 = pat3.search(code)
    if m3:
        code = code[:m3.start()] + new_rev + code[m3.end():]
        print('Replaced executeGetRevenueTool with alternative pattern!')

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(code)
