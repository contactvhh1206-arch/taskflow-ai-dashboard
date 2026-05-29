import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

new_api_code = """
// API: AI Tự Học Từ Chat (Admin One-Click)
app.post('/api/rag/learn-from-chat', authenticateUser, async (req, res) => {
    try {
        const { role, department_code } = req.user;
        
        // Bảo mật (RBAC): Chỉ các cấp cao được phép "dạy" AI
        if (role !== 'SUPER_ADMIN' && role !== 'VICE_PRESIDENT' && role !== 'ADMIN') {
            return res.status(403).json({ error: "Chỉ Admin/Sếp mới có quyền nạp dữ liệu Chat vào RAG." });
        }

        const { content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ error: "Nội dung đoạn chat không được để trống." });
        }

        const textContent = content.trim();

        // Thuật toán Chunking (Ngữ nghĩa)
        const chunks = [];
        const sentences = textContent.split(/(?<=[.!?\\n])\s+/);
        
        let currentChunk = "";
        for (const sentence of sentences) {
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

        const departmentCode = department_code || 'GLOBAL'; 
        let successCount = 0;

        for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk);
            
            const insertSql = `
                INSERT INTO company_knowledge_base (content, embedding, source_type, metadata)
                VALUES ($1, $2::vector, $3, $4)
            `;
            await pool.query(insertSql, [
                chunk, 
                JSON.stringify(embedding), 
                'CHAT_LEARNING', 
                JSON.stringify({ 
                    department_code: departmentCode, 
                    source: 'Admin_One_Click' 
                })
            ]);
            successCount++;
        }

        res.json({ 
            success: true, 
            chunks_processed: successCount, 
            message: `Đã nạp thành công ${successCount} khối kiến thức vào não AI.` 
        });

    } catch (error) {
        console.error("Lỗi learn-from-chat:", error);
        res.status(500).json({ error: "Lỗi máy chủ khi nhúng dữ liệu chat." });
    }
});
"""

# Insert it right before "app.get('/api/ai/sessions'"
text = text.replace("app.get('/api/ai/sessions'", new_api_code + "\\n  app.get('/api/ai/sessions'")

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("API /api/rag/learn-from-chat added successfully.")
