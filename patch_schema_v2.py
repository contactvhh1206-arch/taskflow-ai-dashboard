import re

with open('agent/rules/stitch_smart_ai_task_management_system/server/schema.sql', 'r', encoding='utf-8') as f:
    text = f.read()

old_index = """-- Tạo Index để search tốc độ cao (HNSW)
CREATE INDEX IF NOT EXISTS company_knowledge_base_embedding_idx 
ON company_knowledge_base USING hnsw (embedding vector_cosine_ops);"""

new_index = """-- Tạo Index để search tốc độ cao (HNSW)
CREATE INDEX IF NOT EXISTS company_knowledge_vector_idx 
ON company_knowledge_base USING hnsw (embedding vector_cosine_ops);

-- GIN Index cho Metadata để phục vụ Filter RBAC siêu tốc
CREATE INDEX IF NOT EXISTS company_knowledge_metadata_gin_idx 
ON company_knowledge_base USING gin (metadata);"""

if old_index in text:
    text = text.replace(old_index, new_index)
else:
    print("WARNING: Old index text not found in schema.sql. Appending to end.")
    text += "\n" + new_index

with open('agent/rules/stitch_smart_ai_task_management_system/server/schema.sql', 'w', encoding='utf-8') as f:
    f.write(text)

print("schema.sql updated successfully.")
