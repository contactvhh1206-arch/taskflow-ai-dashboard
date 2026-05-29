import re

# 1. Update schema.sql
with open('agent/rules/stitch_smart_ai_task_management_system/server/schema.sql', 'r', encoding='utf-8') as f:
    schema = f.read()

# Remove ai_token_usage_logs table definition
schema = re.sub(r'-- 8\. Bảng Theo dõi Token AI.*?CREATE POLICY super_admin_all_tokens ON ai_token_usage_logs.*?WHERE u\.id = current_user_id\(\) AND r\.name IN \(\'SUPER_ADMIN\', \'ADMIN\'\)\);', '', schema, flags=re.DOTALL|re.IGNORECASE)

# Alter ai_ping_logs if not already altered
if 'prompt_tokens' not in schema:
    schema = schema.replace(
        "CREATE TABLE ai_ping_logs (\n    id SERIAL PRIMARY KEY,\n    task_id VARCHAR(255) REFERENCES tasks(id) ON DELETE CASCADE,\n    message TEXT,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);",
        "CREATE TABLE ai_ping_logs (\n    id SERIAL PRIMARY KEY,\n    task_id VARCHAR(255) REFERENCES tasks(id) ON DELETE CASCADE,\n    message TEXT,\n    prompt_tokens INT DEFAULT 0,\n    completion_tokens INT DEFAULT 0,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);"
    )

with open('agent/rules/stitch_smart_ai_task_management_system/server/schema.sql', 'w', encoding='utf-8') as f:
    f.write(schema)

# 2. Update server.js initDB
with open('server.js', 'r', encoding='utf-8') as f:
    server = f.read()

initdb_code = """
    // Dọn dẹp DB theo lệnh CTO
    try {
        await pool.query(`DROP TABLE IF EXISTS ai_token_usage_logs CASCADE`);
    } catch (e) { console.error(e); }
    try {
        await pool.query(`
            ALTER TABLE ai_ping_logs 
            ADD COLUMN prompt_tokens INT DEFAULT 0,
            ADD COLUMN completion_tokens INT DEFAULT 0
        `);
    } catch (e) {
        // Ignore if columns already exist
    }
"""

if "DROP TABLE IF EXISTS ai_token_usage_logs" not in server:
    server = server.replace("await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);", "await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);\n" + initdb_code)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server)

print("DB cleanup script written and applied.")
