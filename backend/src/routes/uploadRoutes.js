const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadToStorage } = require('../config/supabaseAdmin');
const authGuard = require('../middlewares/authGuard');

// Multer: lưu file vào RAM (không ghi disk), giới hạn 20MB
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }
});

/**
 * POST /api/upload/attachment
 * Upload file lên Supabase Storage bucket 'attachments' qua service_role key (bypass RLS)
 * Body: multipart/form-data, field name: 'file'
 */
router.post('/attachment', authGuard, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Không có file được gửi lên.' });
        }

        const file = req.file;
        const ext = file.originalname.split('.').pop() || 'bin';
        const mimeType = file.mimetype || 'application/octet-stream';

        // Tạo tên file duy nhất tránh trùng
        const prefix = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'file';
        const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

        // Upload lên Supabase Storage qua REST API (service_role key, bypass RLS)
        const { publicUrl } = await uploadToStorage('attachments', fileName, file.buffer, mimeType);

        console.log(`[upload/attachment] OK: ${fileName} (${file.size} bytes)`);
        res.json({ success: true, url: publicUrl, fileName });

    } catch (err) {
        console.error('[upload/attachment] Lỗi server:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi upload file: ' + err.message });
    }
});

module.exports = router;

