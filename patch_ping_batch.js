const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const targetStr = '// ==============================================================================\n// 4.';
const injectionStr = 
// ==============================================================================
// 3.5 BATCH AI PING
// ==============================================================================
app.post('/api/ai/ping-batch', authenticateUser, async (req, res) => {
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'Thiếu danh sách công việc.' });
    }

    const { rows: taskRows } = await pool.query(\
      SELECT t.id, t.title, TO_CHAR(t.deadline, 'YYYY-MM-DD') as deadline, u.full_name as pic_name
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      WHERE t.id = ANY()
    \, [taskIds]);
    
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy công việc nào.' });
    }

    const { rows: configRows } = await pool.query("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'");
    const aiConfig = configRows.length > 0 ? configRows[0].data : {};
    const aiModel = aiConfig.model || "google/gemini-2.5-flash";

    const pingPromises = taskRows.map(async (task) => {
      try {
        const toneEscalation = calculateTone(task.deadline);
        const systemPrompt = \
          Bạn là một Trợ lý AI Cố vấn (AI Executive Advisor) trong hệ thống TaskFlow AI. 
          Bạn đang thực hiện tính năng "Đôn đốc Thấu cảm" (Empathetic Ping) nhằm tạo áp lực tiến độ một cách tinh tế.
          
          Thông tin công việc:
          - Tên công việc: "\"
          - Người phụ trách (PIC): \
          - Hạn chót: \
          - Mức độ cảnh báo (Tone Escalation): \
          - Định hướng giọng điệu: \

          Nhiệm vụ: Viết một tin nhắn ngắn gọn (dưới 50 chữ), xưng hô lịch sự với \.
          Đúng chuẩn mức độ cảnh báo được yêu cầu. Không thêm lời chào thừa thãi như "Chào bạn", đi thẳng vào vấn đề theo cách thấu cảm.
        \;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": \\\Bearer \\\\, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: aiModel,
            messages: [
              { role: "system", content: systemPrompt }
            ]
          })
        });

        const aiData = await response.json();
        let pingMessage = "Hệ thống: Công việc đang tới hạn.";
        if (aiData.choices && aiData.choices.length > 0) {
          pingMessage = aiData.choices[0].message.content.trim();
        }

        await pool.query('INSERT INTO ai_ping_logs (task_id, message) VALUES (, )', [task.id, pingMessage]);

        return {
          taskId: task.id,
          generated_message: pingMessage
        };
      } catch (innerErr) {
        console.error('Lỗi ping task ' + task.id, innerErr);
        return {
          taskId: task.id,
          generated_message: \Hệ thống: Công việc "\" đang tới hạn.\
        };
      }
    });

    const results = await Promise.all(pingPromises);

    res.json({
      success: true,
      message: 'Đã gửi AI Batch Ping thành công.',
      data: results
    });

  } catch (error) {
    console.error('Lỗi khi gọi AI Ping Batch:', error);
    res.status(500).json({ error: 'Lỗi khi gọi AI API.' });
  }
});

// ==============================================================================
// 4.\;

if (content.includes('3.5 BATCH AI PING')) {
   console.log('Already patched!');
} else {
   content = content.replace(targetStr, injectionStr);
   fs.writeFileSync('server.js', content, 'utf8');
   console.log('Successfully patched server.js!');
}
