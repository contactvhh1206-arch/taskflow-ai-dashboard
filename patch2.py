import re

with open('backend/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace the DROP TABLE line
drop_table_str = "await pool.query(`DROP TABLE IF EXISTS ai_token_usage_logs CASCADE`);"
create_table_str = """await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_token_usage_logs (
            id SERIAL PRIMARY KEY,
            user_id INT,
            username VARCHAR(255),
            role VARCHAR(50),
            facility_id INT,
            department_code VARCHAR(50),
            model VARCHAR(255),
            prompt_tokens INT DEFAULT 0,
            completion_tokens INT DEFAULT 0,
            total_tokens INT DEFAULT 0,
            message_id INT,
            task_type VARCHAR(50),
            status VARCHAR(50) DEFAULT 'OK',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);"""
content = content.replace(drop_table_str, create_table_str)

# 2. Replace the query in /api/ai/audit-logs
old_query = """            SELECT 
                t.message_id,
                t.task_type,
                t.total_tokens,
                t.status,
                t.user_id,
                t.facility_id,
                t.department_code,
                c.created_at,
                c.is_violation
            FROM ai_token_usage_logs t
            JOIN ai_chat_messages c ON t.message_id = c.id
            ${queryCondition}
            ORDER BY c.created_at DESC
            LIMIT 100;"""

new_query = """            SELECT 
                t.id as message_id,
                COALESCE(t.task_type, 'Auto-Tasking') as task_type,
                t.total_tokens,
                COALESCE(t.status, 'OK') as status,
                t.user_id,
                t.facility_id,
                t.department_code,
                t.created_at,
                false as is_violation
            FROM ai_token_usage_logs t
            ${queryCondition}
            ORDER BY t.created_at DESC
            LIMIT 100;"""

content = content.replace(old_query, new_query)

with open('backend/server.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Successfully patched server.js for audit logs")
