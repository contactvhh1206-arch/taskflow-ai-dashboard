import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_rag = r"""        // 2\. Tách nhánh Truy vấn với biến perms chuẩn hóa
        if \(perms\.isGlobal\) \{
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - \(embedding <=> \$1::vector\) AS similarity 
                FROM company_knowledge_base 
                ORDER BY 
                    \(embedding <=> \$1::vector\) ASC, 
                    created_at DESC
                LIMIT \$2
            `;
            params = \[formatEmbedding, limit\];
        \} else \{
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - \(embedding <=> \$1::vector\) AS similarity 
                FROM company_knowledge_base 
                WHERE \(metadata @> '\{"department_code": "GLOBAL"\}'::jsonb\)
                   OR \(\$3::text IS NOT NULL AND metadata @> jsonb_build_object\('department_code', \$3::text\)\)
                   OR \(\$4::text IS NOT NULL AND metadata @> jsonb_build_object\('facility_id', \$4::text\)\)
                ORDER BY 
                    \(embedding <=> \$1::vector\) ASC, 
                    created_at DESC
                LIMIT \$2
            `;
            params = \[formatEmbedding, limit, perms\.departmentCode, perms\.facilityId\];
        \}"""

new_rag = """        // 2. Tách nhánh Truy vấn với biến perms chuẩn hóa
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
        }"""

content = re.sub(old_rag, new_rag, content, flags=re.DOTALL)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched RAG queries!")
