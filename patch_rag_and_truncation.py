import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Patch searchKnowledgeBase
old_sql_block = """        // 4. Tách nhánh Truy vấn sử dụng toán tử JSONB tối ưu (@>)
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
        }"""

new_sql_block = """        // 4. Tách nhánh Truy vấn sử dụng toán tử JSONB tối ưu (@>)
        if (isAllAccess) {
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
            // Sử dụng toán tử @> để kích hoạt GIN Index, ép kiểu tường minh $3::text
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE metadata @> jsonb_build_object('department_code', $3::text)
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;
            params = [formatEmbedding, limit, department_code];
        }"""

text = text.replace(old_sql_block, new_sql_block)

# 2. Patch Truncation in /api/ai/chat
old_rag_context = """        // Phục dựng lại mảng messages (RAG + Context Window)
        const ragContextRows = await searchKnowledgeBase(userMessage, req.user, 3);
        const ragContextText = ragContextRows.map(row => row.content).join(String.fromCharCode(10));"""

new_rag_context = """        // Phục dựng lại mảng messages (RAG + Context Window)
        const ragContextRows = await searchKnowledgeBase(userMessage, req.user, 3);
        const rawRagText = ragContextRows.map(row => row.content).join("\\n\\n");
        // Giới hạn max 4000 ký tự (Khoảng 1000 tokens) để chống vỡ Context Window
        const ragContextText = rawRagText.length > 4000 ? rawRagText.substring(0, 4000) + "\\n... [Đã cắt bớt do giới hạn bộ nhớ]" : rawRagText;"""

text = text.replace(old_rag_context, new_rag_context)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Patch applied successfully!")
