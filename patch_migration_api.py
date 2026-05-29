import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    text = f.read()

migration_api = """
// ==========================================
// ONE-OFF MIGRATION API (TẠM THỜI)
// ==========================================
app.get('/api/dev/migrate-departments', async (req, res) => {
    try {
        await pool.query(`
            UPDATE tasks 
            SET department_code = 'MARKETING' 
            WHERE department_code ILIKE '%Truyền%' OR department_code ILIKE '%MKT%' OR department_code IS NULL
        `);
        
        await pool.query(`
            UPDATE tasks 
            SET department_code = 'ACCOUNTING' 
            WHERE department_code ILIKE '%Kế toán%' OR department_code ILIKE '%Ke toan%' OR department_code ILIKE '%ACC%'
        `);
        
        await pool.query(`
            UPDATE tasks 
            SET department_code = 'HR' 
            WHERE department_code ILIKE '%Nhân sự%' OR department_code ILIKE '%Nhan su%' OR department_code ILIKE '%HR%'
        `);
        
        res.json({ success: true, message: 'Dọn rác Database thành công!' });
    } catch (error) {
        console.error("Migration Error:", error);
        res.status(500).json({ success: false, error: 'Lỗi khi chạy Migration' });
    }
});

// Start server
"""

text = text.replace("// Start server\n", migration_api)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("Migration API injected into server.js")
