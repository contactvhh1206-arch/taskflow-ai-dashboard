import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

new_search_func = """// ==============================================================================
// TẦNG RAG SEARCH KẾT HỢP RBAC FILTERING (VERSION 2 - CHUẨN KIẾN TRÚC)
// ==============================================================================
async function searchKnowledgeBase(queryText, user, limit = 3) {
    try {
        // 1. Validate dữ liệu đầu vào chặt chẽ
        if (!user || !user.role) {
            throw new Error("Thông tin người dùng không hợp lệ để phân quyền.");
        }

        const queryEmbedding = await generateEmbedding(queryText);
        if (!queryEmbedding) throw new Error("Không thể tạo vector cho câu truy vấn.");
        
        const formatEmbedding = `[${queryEmbedding.join(',')}]`;
        const { role, department_code } = user;
        
        // 2. Phân loại nhóm All-Access
        const isAllAccess = 
            role === 'SUPER_ADMIN' || 
            role === 'VICE_PRESIDENT' || 
            (role === 'DEPARTMENT_HEAD' && department_code === 'MARKETING');

        // 3. Kiểm tra an toàn cho nhóm Local
        if (!isAllAccess && !department_code) {
            console.error(`CẢNH BÁO BẢO MẬT: Người dùng ${user.id} thiếu department_code khi truy cập RAG.`);
            throw new Error("Tài khoản của bạn chưa được cấu hình phòng ban. Truy cập bị từ chối.");
        }

        let sql = "";
        let params = [];

        // 4. Tách nhánh Truy vấn sử dụng toán tử JSONB tối ưu (@>)
        if (isAllAccess) {
            sql = `
                SELECT id, content, source_type, metadata, 
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                ORDER BY embedding <=> $1::vector 
                LIMIT $2
            `;
            params = [formatEmbedding, limit];
        } else {
            // Sử dụng toán tử @> để kích hoạt GIN Index, ép kiểu tường minh $3::text
            sql = `
                SELECT id, content, source_type, metadata, 
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE metadata @> jsonb_build_object('department_code', $3::text)
                ORDER BY embedding <=> $1::vector 
                LIMIT $2
            `;
            params = [formatEmbedding, limit, department_code];
        }
        
        const { rows } = await pool.query(sql, params);
        return rows;
    } catch (error) {
        console.error('searchKnowledgeBase Error:', error);
        throw error;
    }
}"""

# 1. Replace the function
text = re.sub(r'async function searchKnowledgeBase\(queryText, limit = 3\) \{.*?throw error;\s+\}\s+\}', new_search_func, text, flags=re.DOTALL)

# 2. Update /api/ai/chat call
old_call = "const memoryResults = await searchKnowledgeBase(userMessage, 3);"
new_call = "const memoryResults = await searchKnowledgeBase(userMessage, req.user, 3);"
text = text.replace(old_call, new_call)

# 3. Add Indexes to initDB
old_index = """        CREATE INDEX IF NOT EXISTS company_knowledge_base_embedding_idx 
        ON company_knowledge_base USING hnsw (embedding vector_cosine_ops)
    `);"""
new_index = """        CREATE INDEX IF NOT EXISTS company_knowledge_vector_idx 
        ON company_knowledge_base USING hnsw (embedding vector_cosine_ops)
    `);
    
    await pool.query(`
        CREATE INDEX IF NOT EXISTS company_knowledge_metadata_gin_idx 
        ON company_knowledge_base USING gin (metadata)
    `);"""
text = text.replace(old_index, new_index)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Patch applied successfully.")
