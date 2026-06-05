const cron = require('node-cron');
const pool = require('../config/database');

const runAIPingJob = async () => {
    console.log('[AI Ping Cron] Starting scheduled task scan...');
    try {
        // Quét các Task trễ hạn hoặc đến hạn hôm nay
        const { rows: tasks } = await pool.query(`
            SELECT id, title, pic_id AS user_id, deadline 
            FROM tasks 
            WHERE LOWER(status) IN ('todo', 'in_progress') 
              AND DATE(deadline) <= CURRENT_DATE
              AND pic_id IS NOT NULL
        `);

        for (const task of tasks) {
            try {
                // Kiểm tra xem hôm nay đã nhắc task này chưa
                const { rows: logs } = await pool.query(`
                    SELECT id FROM ai_ping_logs 
                    WHERE task_id = $1 AND DATE(created_at) = CURRENT_DATE
                `, [task.id]);

                if (logs.length > 0) continue; // Đã nhắc rồi thì bỏ qua

                const prompt = `Bạn là Trợ lý AI thấu cảm. User đang có công việc "${task.title}" sắp đến hạn hoặc đã quá hạn. Hãy sinh ra 1 câu nhắc nhở ngắn gọn, động viên, không mang tính ra lệnh hay tạo áp lực. Dưới 30 tokens.`;
                
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: "openai/gpt-4o-mini", // Model siêu nhẹ, siêu tốc
                        messages: [{ role: "system", content: prompt }],
                        max_tokens: 60
                    })
                });

                if (!response.ok) throw new Error('OpenRouter API Error: ' + response.statusText);
                const data = await response.json();
                const aiMessage = data.choices[0].message.content;

                // Ghi vào Notification để UI hiển thị
                await pool.query(`
                    INSERT INTO ai_notifications (user_id, task_id, message, is_read) 
                    VALUES ($1, $2, $3, false)
                `, [task.user_id, task.id, aiMessage]);

                // Ghi vào Log để khóa mõm ngày hôm nay
                await pool.query(`
                    INSERT INTO ai_ping_logs (user_id, task_id, ping_type) 
                    VALUES ($1, $2, 'WARNING')
                `, [task.user_id, task.id]);

                // KỶ LUẬT THÉP: Ngủ 1.5 giây để làm mát API, chống sập Rate Limit
                await new Promise(r => setTimeout(r, 1500));

            } catch (err) {
                console.error(`[AI Ping Cron] Task ${task.id} Error:`, err.message);
                // Lỗi 1 task thì nuốt lỗi, chạy tiếp task sau
            }
        }
    } catch (err) {
        console.error('[AI Ping Cron] Main Loop Error:', err.message);
    }
};

// Thiết lập cron chạy mỗi 1 tiếng (0 * * * *)
cron.schedule('0 * * * *', runAIPingJob);

module.exports = { runAIPingJob };
