import sys

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace 1: facility_id extraction
old_extract = "const { role, department_code } = user;"
new_extract = "const { role, department_code, facility_id } = user;"
content = content.replace(old_extract, new_extract)

# Replace 2: local access check
old_check = '''        if (!isAllAccess && !department_code) {
            console.error(\C?NH BÁO B?O M?T: Ngu?i dùng \ thi?u department_code khi truy c?p RAG.\);
            throw new Error("Tài kho?n c?a b?n chua du?c c?u hình phòng ban. Truy c?p b? t? ch?i.");
        }'''
new_check = '''        if (!isAllAccess && !department_code && !facility_id) {
            console.error(\C?NH BÁO B?O M?T: Ngu?i dùng \ thi?u c? department_code và facility_id.\);
            throw new Error("Tài kho?n c?a b?n chua du?c c?u hình phòng ban ho?c co s?. Truy c?p b? t? ch?i.");
        }'''
content = content.replace(old_check, new_check)

# Replace 3: else block SQL
old_sql_part = '''        } else {
            // S? d?ng toán t? @> d? kích ho?t GIN Index, ép ki?u tu?ng minh ::text
            sql = \
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> ::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE (metadata @> jsonb_build_object('department_code', ::text)) 
                   OR (metadata @> '{"department_code": "GLOBAL"}'::jsonb)
                ORDER BY 
                    (embedding <=> ::vector) ASC, 
                    created_at DESC
                LIMIT 
            \;
            params = [formatEmbedding, limit, department_code];
        }'''
new_sql_part = '''        } else {
            sql = \
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> ::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE (metadata @> '{"department_code": "GLOBAL"}'::jsonb)
                   OR (::text IS NOT NULL AND metadata @> jsonb_build_object('department_code', ::text))
                   OR (::text IS NOT NULL AND metadata @> jsonb_build_object('facility_id', ::text))
                ORDER BY 
                    (embedding <=> ::vector) ASC, 
                    created_at DESC
                LIMIT 
            \;
            params = [formatEmbedding, limit, department_code || null, facility_id || null];
        }'''
content = content.replace(old_sql_part, new_sql_part)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced!")
