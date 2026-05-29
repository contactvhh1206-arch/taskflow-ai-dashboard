import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

sql_to_inject = """
    // =========================================
    // KÍCH HOẠT VECTOR VÀ BẢNG RAG (KNOWLEDGE BASE)
    // =========================================
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS company_knowledge_base (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            embedding vector(1536),
            source_type VARCHAR(50),
            metadata JSONB,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await pool.query(`
        CREATE INDEX IF NOT EXISTS company_knowledge_base_embedding_idx 
        ON company_knowledge_base USING hnsw (embedding vector_cosine_ops)
    `);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS daily_financial_reports"""

text = text.replace("await pool.query(`CREATE TABLE IF NOT EXISTS daily_financial_reports", sql_to_inject)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected RAG initialization into initDB.")
