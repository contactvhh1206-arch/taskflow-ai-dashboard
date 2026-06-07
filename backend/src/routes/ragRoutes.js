const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');
const rbacGuard = require('../middlewares/rbacGuard');
const ragService = require('../services/ragService');
// Setup Multer (chỉ cho phép .txt tối đa 500KB)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 500 * 1024 }, // 500KB
    fileFilter: (req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.txt')) {
            return cb(new Error('Chỉ chấp nhận file .txt'));
        }
        cb(null, true);
    }
});

// Hàm tiện ích: Tự động tạo bảng rag_documents nếu chưa có
const initRagTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rag_documents (
            id SERIAL PRIMARY KEY,
            file_name VARCHAR(255) NOT NULL,
            file_size INT NOT NULL,
            chunk_count INT NOT NULL,
            status VARCHAR(50) DEFAULT 'Đã mã hóa',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
};

// Lấy danh sách tài liệu
router.get('/documents', authGuard, rbacGuard, async (req, res) => {
    try {
        await initRagTable();
        const { rows } = await pool.query('SELECT * FROM rag_documents ORDER BY created_at DESC');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Lỗi GET RAG documents:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Upload tài liệu mới
router.post('/upload', authGuard, rbacGuard, upload.single('file'), async (req, res) => {
    try {
        await initRagTable();
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Không tìm thấy tệp' });
        }

        // Quá trình Chunking & Embedding thực tế
        const textContent = req.file.buffer.toString('utf8');
        const chunkSize = 1000;
        const chunks = [];
        for (let i = 0; i < textContent.length; i += chunkSize) {
            chunks.push(textContent.substring(i, i + chunkSize));
        }
        const chunkCount = chunks.length;

        // Lưu vào Database quản lý UI (rag_documents)
        const { rows } = await pool.query(
            `INSERT INTO rag_documents (file_name, file_size, chunk_count) 
             VALUES ($1, $2, $3) RETURNING id`,
            [req.file.originalname, req.file.size, chunkCount]
        );

        // Lưu nội dung và vector vào company_knowledge_base
        let chunksProcessed = 0;
        for (let i = 0; i < chunks.length; i++) {
            try {
                await ragService.saveToKnowledgeBase(chunks[i], 'DOCUMENT_UPLOAD', {
                    filename: req.file.originalname,
                    chunk_index: i,
                    total_chunks: chunkCount,
                    department_code: req.user.department_code || 'GLOBAL',
                    facility_id: req.user.facility_id,
                    uploader_id: req.user.id
                });
                chunksProcessed++;
            } catch (err) {
                console.error(`Lỗi tạo vector chunk ${i}:`, err.message);
            }
        }

        res.json({ 
            success: true, 
            message: 'Đã mã hóa Vector thành công',
            document_id: rows[0].id,
            chunks_processed: chunksProcessed
        });
    } catch (error) {
        console.error('Lỗi POST RAG upload:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Xóa tài liệu
router.delete('/documents/:id', authGuard, rbacGuard, async (req, res) => {
    try {
        await initRagTable();
        const { id } = req.params;
        await pool.query('DELETE FROM rag_documents WHERE id = $1', [id]);
        res.json({ success: true, message: 'Đã xóa tài liệu' });
    } catch (error) {
        console.error('Lỗi DELETE RAG document:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Xử lý lỗi từ Multer (ví dụ: file quá lớn)
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === 'Chỉ chấp nhận file .txt') {
        return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
});

module.exports = router;
