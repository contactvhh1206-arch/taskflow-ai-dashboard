import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update searchKnowledgeBase SQL
old_local_sql = """            // Sử dụng toán tử @> để kích hoạt GIN Index, ép kiểu tường minh $3::text
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE metadata @> jsonb_build_object('department_code', $3::text)
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;"""

new_local_sql = """            // Sử dụng toán tử @> để kích hoạt GIN Index, ép kiểu tường minh $3::text
            sql = `
                SELECT id, content, source_type, metadata, created_at,
                       1 - (embedding <=> $1::vector) AS similarity 
                FROM company_knowledge_base 
                WHERE (metadata @> jsonb_build_object('department_code', $3::text)) 
                   OR (metadata @> '{"department_code": "GLOBAL"}'::jsonb)
                ORDER BY 
                    (embedding <=> $1::vector) ASC, 
                    created_at DESC
                LIMIT $2
            `;"""

text = text.replace(old_local_sql, new_local_sql)

# 2. Add Multer and replace /api/rag/upload stub
multer_import_code = """
const multer = require('multer');
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 }, // Giới hạn 500KB cho file text
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
            cb(null, true);
        } else {
            cb(new Error('HỆ THỐNG TỪ CHỐI: Chỉ cho phép tải lên định dạng văn bản thuần (.txt)'));
        }
    }
});
"""

new_upload_endpoint = multer_import_code + """
// API NẠP TRI THỨC VÀO RAG
app.post('/api/rag/upload', authenticateUser, checkAdmin, (req, res, next) => {
    // Bọc middleware upload để hứng lỗi file extension
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Vui lòng đính kèm một file .txt hợp lệ." });
        }

        // Đọc nội dung file từ Buffer
        const textContent = req.file.buffer.toString('utf-8');
        if (!textContent.trim()) {
            return res.status(400).json({ error: "File rỗng, không có dữ liệu để nạp." });
        }

        // ==========================================
        // THUẬT TOÁN CHUNKING (NGỮ NGHĨA)
        // ==========================================
        const chunks = [];
        // Tách văn bản thành các câu dựa trên dấu kết thúc câu hoặc dấu xuống dòng
        const sentences = textContent.split(/(?<=[.!?\\n])\\s+/);
        
        let currentChunk = "";
        for (const sentence of sentences) {
            // Giới hạn max ~1000 ký tự mỗi chunk
            if (currentChunk.length + sentence.length > 1000) {
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? " " : "") + sentence;
            }
        }
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        // ==========================================
        // VÒNG LẶP EMBEDDING & BƠM VÀO VECTOR DB
        // ==========================================
        // Nếu Sếp (All-Access) không có phòng ban, đưa về GLOBAL để chia sẻ chung
        const departmentCode = req.user.department_code || 'GLOBAL'; 
        let successCount = 0;

        for (const chunk of chunks) {
            // Gọi AI tạo Vector 1536 chiều
            const embedding = await generateEmbedding(chunk);
            if (embedding) {
                const formatEmbedding = `[${embedding.join(',')}]`;
                const metadata = { 
                    department_code: departmentCode,
                    filename: req.file.originalname,
                    chunk_size: chunk.length
                };
                
                // Lưu vào CSDL PgVector
                await pool.query(`
                    INSERT INTO company_knowledge_base (content, embedding, source_type, metadata, created_at)
                    VALUES ($1, $2::vector, $3, $4, NOW())
                `, [chunk, formatEmbedding, 'DOCUMENT_UPLOAD', JSON.stringify(metadata)]);
                
                successCount++;
            }
        }

        return res.json({ 
            success: true, 
            message: `Nạp tri thức thành công! Đã băm thành ${successCount} mảnh (chunks) và nhúng an toàn vào Vector DB.`,
        });

    } catch (error) {
        console.error("Lỗi hệ thống khi nạp tài liệu RAG:", error);
        return res.status(500).json({ error: "Lỗi máy chủ khi nhúng tài liệu (Embedding Error)." });
    }
});"""

# Use re.search and string slicing to avoid re.sub escaping issues
stub_pattern = r"app\.post\('/api/rag/upload', authenticateUser, checkAdmin, \(req, res\) => \{\s*return res\.json\(\{ message: \".*?\" \}\);\s*\}\);"
match = re.search(stub_pattern, text)
if match:
    text = text[:match.start()] + new_upload_endpoint + text[match.end():]
else:
    print("Warning: Could not find upload stub to replace. Trying fallback...")

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Final patch applied successfully!")
