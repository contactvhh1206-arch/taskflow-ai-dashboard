/**
 * Script chạy 1 lần: học lại các session bị bỏ sót do lỗi JSON cắt cụt (05/07 - 24/07/2026).
 * Cách chạy (trong Render Shell, tại thư mục backend):
 *     node scripts/backfill_learning.js
 * Bước 1: reset cờ learning_processed cho các session chưa từng tạo ra bài học nào.
 * Bước 2: chạy lại job học với cửa sổ quét 21 ngày (504 giờ).
 */
const pool = require('../src/config/database');
const { runLearningJob } = require('../src/cron/aiLearningJob');

// 00:00 UTC ngày 04/07/2026 (ms epoch) — trước đêm học thành công cuối cùng
const SINCE_MS = 1783123200000;

(async () => {
    try {
        const { rowCount } = await pool.query(`
            UPDATE ai_chat_sessions
            SET learning_processed = false
            WHERE learning_processed = true
              AND timestamp >= $1
              AND id NOT IN (
                  SELECT source_session_id FROM ai_learned_insights
                  WHERE source_session_id IS NOT NULL
              )
        `, [SINCE_MS]);
        console.log(`[Backfill] Đã reset ${rowCount} session bị bỏ sót.`);

        await runLearningJob(504);

        console.log('[Backfill] HOÀN TẤT. Kiểm tra trang Bài học AI trên app.');
        process.exit(0);
    } catch (err) {
        console.error('[Backfill] LỖI:', err.message);
        process.exit(1);
    }
})();
