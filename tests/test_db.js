const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function test() {
    try {
        const sql1 = 
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
            ;
        const formatEmbedding = '[' + new Array(1536).fill(0.1).join(',') + ']';
        console.log('Testing RAG Query...');
        await pool.query(sql1, [formatEmbedding, 3, 'FINANCE', null]);
        console.log('RAG Query SUCCESS!');

        const sql2 = SELECT COALESCE(SUM(total_revenue), 0) AS aggregated_revenue 
               FROM daily_financial_reports 
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= (CASE WHEN $1::text LIKE '%-%' THEN $1::date ELSE to_date($1::text, 'DD/MM/YYYY') END) 
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= (CASE WHEN $2::text LIKE '%-%' THEN $2::date ELSE to_date($2::text, 'DD/MM/YYYY') END);
        console.log('Testing Revenue Query...');
        await pool.query(sql2, ['2026-05-01', '2026-05-29']);
        console.log('Revenue Query SUCCESS!');
        
    } catch(e) {
        console.error('DB ERROR:', e.message);
    } finally {
        pool.end();
    }
}

test();
