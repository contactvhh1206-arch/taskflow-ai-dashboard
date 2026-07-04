const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');
const rbacGuard = require('../middlewares/rbacGuard');
const ragService = require('../services/ragService');
// Setup Multer (chỉ cho phép .txt tối đa 500KB) - Giờ không cần dùng nữa nhưng giữ lại phòng hờ API cũ
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

const fetch = global.fetch || require('node-fetch');

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
router.post('/upload', authGuard, rbacGuard, express.json(), async (req, res) => {
    try {
        await initRagTable();
        const { fileUrl, fileName, fileSize } = req.body;
        
        if (!fileUrl) {
            return res.status(400).json({ success: false, error: 'Thiếu đường dẫn fileUrl' });
        }

        // Tải nội dung text từ URL của Supabase
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
            throw new Error(`Không thể tải file từ Supabase: ${fileResponse.statusText}`);
        }
        const textContent = await fileResponse.text();

        // Quá trình Chunking & Embedding thực tế
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
            [fileName || 'unknown.txt', fileSize || textContent.length, chunkCount]
        );

        // Lưu nội dung và vector vào company_knowledge_base
        let chunksProcessed = 0;
        for (let i = 0; i < chunks.length; i++) {
            try {
                await ragService.saveToKnowledgeBase(chunks[i], 'DOCUMENT_UPLOAD', {
                    filename: fileName || 'unknown.txt',
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

// ============================================================
// QUẢN LÝ BÀI HỌC AI (ai_learned_insights) — Chỉ ADMIN
// ============================================================

// Middleware kiểm tra quyền ADMIN
const adminOnly = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Chỉ ADMIN mới có quyền truy cập.' });
    }
    next();
};

// GET /api/rag/insights — Lấy danh sách bài học (có phân trang + lọc)
router.get('/insights', authGuard, adminOnly, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const category = req.query.category || null;   // Lọc theo loại
        const isActive = req.query.is_active;           // 'true' | 'false' | undefined

        let conditions = [];
        let params = [];
        let paramIdx = 1;

        if (category) {
            conditions.push(`category = $${paramIdx++}`);
            params.push(category);
        }
        if (isActive !== undefined) {
            conditions.push(`is_active = $${paramIdx++}`);
            params.push(isActive === 'true');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Lấy tổng số bản ghi
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM ai_learned_insights ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        // Lấy dữ liệu với phân trang
        const { rows } = await pool.query(
            `SELECT id, insight_text, category, importance, is_active,
                    source_session_id, source_user_id, source_facility_id, created_at
             FROM ai_learned_insights
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            [...params, limit, offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Lỗi GET insights:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/rag/insights/:id/toggle — Bật/tắt bài học (soft delete)
router.patch('/insights/:id/toggle', authGuard, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await pool.query(
            `UPDATE ai_learned_insights
             SET is_active = NOT is_active
             WHERE id = $1
             RETURNING id, is_active`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài học.' });
        }
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Lỗi PATCH toggle insight:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/rag/insights/:id — Xóa vĩnh viễn bài học
router.delete('/insights/:id', authGuard, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM ai_learned_insights WHERE id = $1 RETURNING id',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài học.' });
        }
        res.json({ success: true, message: 'Đã xóa bài học vĩnh viễn.' });
    } catch (error) {
        console.error('Lỗi DELETE insight:', error);
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
