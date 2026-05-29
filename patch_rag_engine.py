import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

rag_engine_code = """
// ==============================================================================
// RAG ENGINE UTILS (Embedding & Knowledge Base)
// ==============================================================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function generateEmbedding(text) {
    if (!text || typeof text !== 'string') return null;
    try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: text.replace(/\\n/g, ' ')
            })
        });
        const data = await response.json();
        if (data.data && data.data.length > 0) {
            return data.data[0].embedding; // Mảng 1536 số thực
        }
        throw new Error(data.error?.message || 'Lỗi không xác định từ OpenAI');
    } catch (error) {
        console.error('generateEmbedding Error:', error);
        return null;
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
        const formatEmbedding = `[${embedding.join(',')}]`; // Định dạng vector cho PgVector
        const { rows } = await pool.query(sql, [content, formatEmbedding, sourceType, JSON.stringify(metadata)]);
        return rows[0].id;
    } catch (error) {
        console.error('saveToKnowledgeBase Error:', error);
        throw error;
    }
}

async function searchKnowledgeBase(queryText, limit = 3) {
    try {
        const queryEmbedding = await generateEmbedding(queryText);
        if (!queryEmbedding) throw new Error("Không thể tạo vector cho câu truy vấn.");
        
        const formatEmbedding = `[${queryEmbedding.join(',')}]`;
        
        // Toán tử <=> là Cosine Distance, nên similarity = 1 - distance
        const sql = `
            SELECT id, content, source_type, metadata, 
                   1 - (embedding <=> $1::vector) AS similarity 
            FROM company_knowledge_base 
            ORDER BY embedding <=> $1::vector 
            LIMIT $2
        `;
        
        const { rows } = await pool.query(sql, [formatEmbedding, limit]);
        return rows;
    } catch (error) {
        console.error('searchKnowledgeBase Error:', error);
        throw error;
    }
}

// ==============================================================================
// INIT SERVER
// ==============================================================================
"""

text = text.replace("// ==============================================================================\n// INIT SERVER\n// ==============================================================================", rag_engine_code)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected RAG engine functions into server.js.")
