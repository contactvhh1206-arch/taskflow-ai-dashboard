const cron = require('node-cron');
const pool = require('../config/database');
const ragService = require('../services/ragService');

/**
 * Hàm trích xuất bài học từ một session chat cụ thể.
 * Gọi LLM với model rẻ để phân tích hội thoại và rút ra tri thức tái sử dụng.
 */
const extractInsightsFromSession = async (session, messages) => {
    const chatLog = messages
        .map(m => `${m.role === 'user' ? 'QUẢN LÝ' : 'CỐ VẤN AI'}: ${m.content}`)
        .join('\n\n');

    const prompt = `Bạn là AI chuyên phân tích hội thoại quản trị vận hành. Đọc cuộc trò chuyện dưới đây giữa quản lý và Cố vấn AI của hệ thống chuỗi cơ sở Hub Dubai.

NHIỆM VỤ: Trích xuất các BÀI HỌC, QUY TẮC, CHỈ THỊ, KINH NGHIỆM có giá trị để áp dụng cho các tình huống tương tự trong tương lai.

CHỈ trích xuất nếu hội thoại chứa một trong các dạng sau:
1. Chỉ thị mới từ sếp (ví dụ: "Từ nay khi sự cố X xảy ra thì phải làm Y")
2. Phương án kinh doanh đã được sếp phê duyệt/áp dụng
3. Kinh nghiệm xử lý sự cố thực tế
4. Quy tắc/ưu tiên vận hành được đề cập
5. Sở thích/phong cách quản lý của sếp (ví dụ: "tôi muốn xem dạng bảng", "luôn báo số liệu từng cơ sở riêng")

KHÔNG trích xuất: câu hỏi số liệu thông thường (doanh thu bao nhiêu, ai nghỉ...), lời chào hỏi, hoặc thông tin không có giá trị tái sử dụng.

Trả về JSON theo đúng định dạng sau (KHÔNG thêm text ngoài JSON):
{
  "insights": [
    {
      "text": "Mô tả bài học/chỉ thị ngắn gọn, rõ ràng, có thể tái sử dụng ngay (1-3 câu)",
      "category": "operations|revenue|directive|incident|preference",
      "importance": 7
    }
  ]
}

Nếu không có bài học giá trị, trả về: {"insights": []}

--- CUỘC TRÒ CHUYỆN ---
${chatLog}
--- KẾT THÚC ---`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.SITE_URL || 'https://hubdb.app',
            'X-Title': process.env.SITE_NAME || 'HUBDB'
        },
        body: JSON.stringify({
            model: 'google/gemini-2.5-flash', // Model nhẹ, rẻ, đủ khả năng phân tích
            messages: [{ role: 'system', content: prompt }],
            response_format: { type: 'json_object' },
            max_tokens: 4000
        })
    });

    if (!response.ok) {
        throw new Error(`OpenRouter LLM Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0) {
        return [];
    }

    try {
        const parsed = JSON.parse(data.choices[0].message.content);
        return Array.isArray(parsed.insights) ? parsed.insights : [];
    } catch (e) {
        // Ném lỗi để session KHÔNG bị đánh dấu đã xử lý — sẽ được thử lại đêm sau
        throw new Error(`JSON parse error từ LLM (có thể bị cắt cụt): ${e.message}`);
    }
};

/**
 * Cron job chính: Quét các session hôm nay đủ điều kiện, trích xuất bài học, lưu DB.
 * Chạy mỗi đêm lúc 02:00 AM (giờ UTC+7, tương đương 19:00 UTC trước đó)
 */
const runLearningJob = async (hoursBack = 24) => {
    console.log(`[AI Learning Cron] Bắt đầu quét và trích xuất bài học (cửa sổ ${hoursBack}h)...`);
    try {
        // Lấy các session trong cửa sổ thời gian chưa được xử lý, có >= 4 tin nhắn
        // timestamp trong ai_chat_sessions lưu dạng Unix ms epoch
        const { rows: sessions } = await pool.query(`
            SELECT s.id, s.user_id, s.facility_id
            FROM ai_chat_sessions s
            WHERE s.learning_processed = false
              AND s.timestamp >= EXTRACT(EPOCH FROM NOW() - make_interval(hours => $1)) * 1000
              AND (
                  SELECT COUNT(*) FROM ai_chat_messages m WHERE m.session_id = s.id
              ) >= 4
        `, [hoursBack]);

        if (sessions.length === 0) {
            console.log('[AI Learning Cron] Không có session mới đủ điều kiện.');
            return;
        }

        console.log(`[AI Learning Cron] Tìm thấy ${sessions.length} session cần xử lý.`);

        for (const session of sessions) {
            try {
                // Lấy toàn bộ lịch sử chat của session (chỉ user + assistant, bỏ system)
                const { rows: messages } = await pool.query(`
                    SELECT role, content
                    FROM ai_chat_messages
                    WHERE session_id = $1
                      AND role IN ('user', 'assistant')
                      AND content IS NOT NULL
                      AND TRIM(content) != ''
                    ORDER BY created_at ASC
                `, [session.id]);

                if (messages.length < 4) {
                    // Đánh dấu luôn để không quét lại
                    await pool.query(
                        'UPDATE ai_chat_sessions SET learning_processed = true WHERE id = $1',
                        [session.id]
                    );
                    continue;
                }

                // Gọi LLM trích xuất bài học
                const insights = await extractInsightsFromSession(session, messages);

                if (insights.length > 0) {
                    let savedCount = 0;
                    for (const insight of insights) {
                        // Tạo embedding cho bài học
                        const embedding = await ragService.generateEmbedding(insight.text);
                        if (!embedding) {
                            console.warn('[AI Learning] Không tạo được embedding, bỏ qua bài học:', insight.text.substring(0, 50));
                            continue;
                        }

                        const formatEmbedding = `[${embedding.join(',')}]`;

                        await pool.query(`
                            INSERT INTO ai_learned_insights
                                (insight_text, embedding, category, importance, source_session_id, source_user_id, source_facility_id)
                            VALUES ($1, $2::vector, $3, $4, $5, $6, $7)
                        `, [
                            insight.text.trim(),
                            formatEmbedding,
                            insight.category || 'operations',
                            insight.importance || 5,
                            session.id,
                            session.user_id,
                            session.facility_id || null
                        ]);

                        savedCount++;

                        // Nghỉ 500ms giữa mỗi lần tạo embedding để tránh rate limit
                        await new Promise(r => setTimeout(r, 500));
                    }
                    console.log(`[AI Learning] Session ${session.id}: Lưu ${savedCount}/${insights.length} bài học.`);
                } else {
                    console.log(`[AI Learning] Session ${session.id}: Không có bài học giá trị.`);
                }

                // Đánh dấu session đã xử lý
                await pool.query(
                    'UPDATE ai_chat_sessions SET learning_processed = true WHERE id = $1',
                    [session.id]
                );

                // Nghỉ 2 giây giữa mỗi session để không sập Rate Limit API
                await new Promise(r => setTimeout(r, 2000));

            } catch (err) {
                console.error(`[AI Learning Cron] Lỗi xử lý session ${session.id}:`, err.message);
                // Nuốt lỗi, tiếp tục session tiếp theo — không làm sập cả cron
            }
        }

        console.log('[AI Learning Cron] Hoàn thành.');
    } catch (err) {
        console.error('[AI Learning Cron] Main Loop Error:', err.message);
    }
};

// Chạy mỗi đêm lúc 02:00 AM (giờ server, server đặt UTC+7)
cron.schedule('0 2 * * *', () => runLearningJob(), {
    timezone: 'Asia/Ho_Chi_Minh'
});

console.log('[AI Learning Cron] Đã đăng ký — chạy mỗi đêm lúc 02:00 AM ICT.');

module.exports = { runLearningJob };
