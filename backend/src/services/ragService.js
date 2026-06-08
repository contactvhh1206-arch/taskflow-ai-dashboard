const pool = require('../config/database');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// ==============================================================================
// TRUNG TÂM PHÂN QUYỀN AI (AI RBAC GUARDRAIL)
// ==============================================================================
function getAiPermissions(user) {
    if (!user || !user.role) {
        return { isGlobal: false, departmentCode: null, facilityId: null, facilityCode: null };
    }
    
    const role = user.role;
    const departmentCode = user.department_code || user.department_id || '';
    const facilityId = user.facility_id ? String(user.facility_id) : null;
    const facilityCode = user.facility_code ? String(user.facility_code) : null;
    
    // Quét toàn bộ mọi biến thể tiếng Việt và tiếng Anh của khối Marketing
    const isMarketing = Boolean(String(departmentCode).match(/MARKETING|TRUYỀN THÔNG|MKT|MEDIA/i));
    
    // Xác định quyền All-Access (Global)
    const isGlobal = role === 'SUPER_ADMIN' || 
                     role === 'VICE_PRESIDENT' || 
                     role === 'FINANCE_DEPT' ||
                     isMarketing;
                     
    return {
        isGlobal,
        departmentCode,
        facilityId,
        facilityCode
    };
}

async function generateEmbedding(text) {
    if (!text || typeof text !== 'string') return null;
    try {
        const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": process.env.SITE_URL || "https://www.hubdb.app",
                "X-Title": process.env.SITE_NAME || "Hub Dubai AI"
            },
            body: JSON.stringify({
                model: "openai/text-embedding-3-small", 
                input: text 
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenRouter Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (data.data && data.data.length > 0) {
            return data.data[0].embedding; 
        }
        throw new Error(data.error?.message || 'Lỗi không xác định từ OpenRouter');
    } catch (error) {
        console.error('generateEmbedding Error:', error);
        return null;
    }
}

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
                WHERE 1 - (embedding <=> $1::vector) > 0.3 -- Ngưỡng an toàn chống rác (Hallucination)
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
                WHERE (
                       (metadata @> '{"department_code": "GLOBAL"}'::jsonb)
                       OR ($3::text IS NOT NULL AND metadata @> jsonb_build_object('department_code', $3::text))
                       OR ($4::text IS NOT NULL AND metadata @> jsonb_build_object('facility_id', $4::text))
                       OR ($5::text IS NOT NULL AND metadata @> jsonb_build_object('facility_code', $5::text))
                      )
                  AND 1 - (embedding <=> $1::vector) > 0.3 -- Ngưỡng an toàn chống rác
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;
            params = [formatEmbedding, limit, perms.departmentCode, perms.facilityId, perms.facilityCode];
        }
        
        const { rows } = await pool.query(sql, params);
        return rows;
    } catch (error) {
        console.error('searchKnowledgeBase Error:', error);
        return [{ content: "Hệ thống từ chối: Đã xảy ra lỗi nội bộ khi tra cứu cơ sở tri thức." }];
    }
}

async function saveToKnowledgeBase(content, sourceType, metadata = {}) {
    try {
        const embedding = await generateEmbedding(content);
        if (!embedding) throw new Error("Không thể tạo vector cho nội dung.");
        
        const sql = `
            INSERT INTO company_knowledge_base (content, embedding, source_type, metadata)
            VALUES ($1, $2::vector, $3, $4)
            RETURNING id
        `;
        const formatEmbedding = `[${embedding.join(',')}]`; 
        const { rows } = await pool.query(sql, [content, formatEmbedding, sourceType, JSON.stringify(metadata)]);
        return rows[0].id;
    } catch (error) {
        console.error('saveToKnowledgeBase Error:', error);
        throw error;
    }
}

module.exports = {
    getAiPermissions,
    generateEmbedding,
    searchKnowledgeBase,
    saveToKnowledgeBase
};
