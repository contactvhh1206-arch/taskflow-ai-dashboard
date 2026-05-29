import os
import psycopg2

# 1. Update schema.sql
schema_file = 'agent/rules/stitch_smart_ai_task_management_system/server/schema.sql'
sql_to_append = """

-- ==========================================================
-- AI KNOWLEDGE BASE (RAG)
-- ==========================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS company_knowledge_base (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL, -- Nội dung text đã băm nhỏ (Chunk)
    embedding vector(1536), -- Vector nhúng chuẩn OpenAI
    source_type VARCHAR(50), -- Phân loại: 'DOCUMENT', 'BOSS_INSTRUCTION', 'STAFF_CHAT'
    metadata JSONB, -- Lưu thêm thông tin: file_name, user_id, role...
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tạo Index để search tốc độ cao (HNSW)
CREATE INDEX IF NOT EXISTS company_knowledge_base_embedding_idx 
ON company_knowledge_base USING hnsw (embedding vector_cosine_ops);
"""

try:
    with open(schema_file, 'a', encoding='utf-8') as f:
        f.write(sql_to_append)
    print(f"Updated {schema_file} successfully.")
except Exception as e:
    print("Failed to append to schema.sql:", e)

# 2. Run Migration on Database
env_vars = {}
try:
    with open('agent/rules/stitch_smart_ai_task_management_system/server/.env', 'r') as f:
        for line in f:
            if '=' in line:
                k, v = line.strip().split('=', 1)
                env_vars[k.strip()] = v.strip()
except Exception as e:
    print("Error reading .env:", e)

try:
    conn = psycopg2.connect(
        dbname=env_vars.get('DB_NAME'),
        user=env_vars.get('DB_USER'),
        password=env_vars.get('DB_PASSWORD'),
        host=env_vars.get('DB_HOST', 'localhost')
    )
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    print("Created vector extension.")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS company_knowledge_base (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        embedding vector(1536),
        source_type VARCHAR(50),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
    );
    """)
    print("Created company_knowledge_base table.")

    cur.execute("""
    CREATE INDEX IF NOT EXISTS company_knowledge_base_embedding_idx 
    ON company_knowledge_base USING hnsw (embedding vector_cosine_ops);
    """)
    print("Created HNSW index.")

    cur.close()
    conn.close()
    print("RAG database setup completed successfully.")
except Exception as e:
    print(f"Error setting up RAG DB: {e}")
