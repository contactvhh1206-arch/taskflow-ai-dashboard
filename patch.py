import re

with open('backend/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_code = '''// ==========================================
// RAG MANAGER - THUẬT TOÁN CHUNKING & ROUTES
// ==========================================
function chunkTextWithOverlap(text, chunkSize = 1000, overlap = 150) {
    if (!text) return [];
    const cleanText = text.replace(/\\s+/g, ' ').trim();
    const rawSentences = cleanText.match(/[^.!?]+[.!?]+|\\s*[^.!?]+$/g) || [cleanText];
    const sentences = [];
    for (const raw of rawSentences) {
        let textToSplit = raw.trim();
        while (textToSplit.length > chunkSize) {
            let splitIndex = textToSplit.lastIndexOf(' ', chunkSize);
            if (splitIndex === -1 || splitIndex === 0) splitIndex = chunkSize;
            sentences.push(textToSplit.substring(0, splitIndex).trim());
            textToSplit = textToSplit.substring(splitIndex).trim();
        }
        if (textToSplit) sentences.push(textToSplit);
    }
    const chunks = [];
    let currentChunk = "";
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim();
        if (!sentence) continue;
        if (currentChunk.length + sentence.length <= chunkSize) {
            currentChunk += (currentChunk ? " " : "") + sentence;
        } else {
            if (currentChunk) chunks.push(currentChunk);
            let overlapText = "";
            let j = i - 1;
            while (j >= 0 && overlapText.length + sentences[j].length <= overlap) {
                overlapText = sentences[j].trim() + " " + overlapText;
                j--;
            }
            currentChunk = (overlapText ? overlapText.trim() + " " : "") + sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
}

const ragController = {
    uploadAndVectorizeDocument: async (req, res) => {
        if (!req.file) return res.status(400).json({ success: false, error: "Thiếu tệp đính kèm." });
        const fileName = req.file.originalname;
        const fileSize = req.file.size;
        if (!fileName.toLowerCase().endsWith('.txt') || req.file.mimetype !== 'text/plain') {
            return res.status(400).json({ success: false, error: "Chỉ hỗ trợ định dạng .txt." });
        }
        if (fileSize > 500 * 1024) return res.status(400).json({ success: false, error: "Tệp tin vượt quá 500KB." });
        const textContent = req.file.buffer.toString('utf-8');
        if (!textContent.trim()) return res.status(400).json({ success: false, error: "Tập tin rỗng." });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const metadataSql = "INSERT INTO rag_documents (file_name, file_size, chunk_count, uploader_id, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id";
            const docResult = await client.query(metadataSql, [fileName, fileSize, 0, req.user.id]);
            const documentId = docResult.rows[0].id;
            const chunks = chunkTextWithOverlap(textContent, 1000, 150);
            if (chunks.length === 0) throw new Error("Không thể trích xuất dữ liệu.");

            const BATCH_SIZE = 20; 
            const departmentCode = req.user.department_code || 'GLOBAL';
            let successCount = 0;

            for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
                const batchChunks = chunks.slice(i, i + BATCH_SIZE);
                const batchEmbeddings = await Promise.all(
                    batchChunks.map(async (chunk) => {
                         const vector = await generateEmbedding(chunk); 
                         if (!vector) throw new Error("API Nhúng Vector thất bại.");
                         return vector;
                    })
                );
                for (let j = 0; j < batchChunks.length; j++) {
                    const formatEmbedding = "[" + batchEmbeddings[j].join(',') + "]";
                    const insertSql = "INSERT INTO company_knowledge_base (document_id, content, embedding, source_type, metadata, created_at) VALUES ($1, $2, $3::vector, $4, $5, NOW())";
                    const chunkMetadata = { department_code: departmentCode, chunk_index: i + j, total_chunks: chunks.length };
                    await client.query(insertSql, [documentId, batchChunks[j], formatEmbedding, 'DOCUMENT_UPLOAD', JSON.stringify(chunkMetadata)]);
                    successCount++;
                }
                if (i + BATCH_SIZE < chunks.length) await new Promise(resolve => setTimeout(resolve, 500));
            }
            await client.query("UPDATE rag_documents SET chunk_count = $1 WHERE id = $2", [successCount, documentId]);
            await client.query('COMMIT');
            res.json({ success: true, message: "Đã nhúng thành công " + successCount + " chunks.", document_id: documentId });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ success: false, error: "Dịch vụ AI gián đoạn." });
        } finally {
            client.release();
        }
    },
    getDocuments: async (req, res) => {
        try {
            const sql = "SELECT id, file_name, file_size, chunk_count, uploader_id, created_at FROM rag_documents ORDER BY created_at DESC";
            const { rows } = await pool.query(sql);
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Lỗi máy chủ khi lấy danh sách." });
        }
    },
    deleteDocument: async (req, res) => {
        try {
            const sql = "DELETE FROM rag_documents WHERE id = $1 RETURNING id";
            const { rows } = await pool.query(sql, [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ success: false, error: "Dữ liệu không tồn tại." });
            res.json({ success: true, message: "Xóa thành công." });
        } catch (error) {
            res.status(500).json({ success: false, error: "Lỗi máy chủ khi xóa." });
        }
    }
};

app.post('/api/rag/upload', authenticateUser, checkAdmin, upload.single('file'), ragController.uploadAndVectorizeDocument);
app.get('/api/rag/documents', authenticateUser, checkAdmin, ragController.getDocuments);
app.delete('/api/rag/documents/:id', authenticateUser, checkAdmin, ragController.deleteDocument);
'''

start_str = "app.post('/api/rag/upload'"
end_str = "app.post('/api/ai/auto-tasking'"

start_idx = content.find(start_str)
if start_idx == -1:
    print("Could not find start string")
    exit(1)

comment_idx = content.rfind("//", 0, start_idx)
if comment_idx != -1 and (start_idx - comment_idx) < 100:
    start_idx = comment_idx

end_idx = content.find(end_str, start_idx)
if end_idx == -1:
    print("Could not find end string")
    exit(1)

content = content[:start_idx] + new_code + "\n\n" + content[end_idx:]

with open('backend/server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Successfully patched server.js")
