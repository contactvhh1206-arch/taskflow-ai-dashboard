import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_block = """app.delete('/api/system/reset', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
       return res.status(403).json({ error: 'Không đủ quyền' });
    }
    await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE company_knowledge_base RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE ai_chat_sessions RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE ai_chat_messages RESTART IDENTITY CASCADE');
    await pool.query('DELETE FROM daily_logs WHERE entry_type != $1', ['SYSTEM_CONFIG']);
    await pool.query('DELETE FROM daily_financial_reports');
    res.json({ success: true, message: 'Đã dọn dẹp toàn bộ dữ liệu kiểm thử' });
  } catch (error) {
    console.error("Lỗi reset system:", error);
    res.status(500).json({ error: 'Lỗi máy chủ khi reset system' });
  }
});"""

new_block = """app.delete('/api/system/reset', authenticateUser, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
       return res.status(403).json({ error: 'Không đủ quyền' });
    }
    
    // Khởi tạo Transaction bảo vệ tính toàn vẹn dữ liệu
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE company_knowledge_base RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE ai_chat_sessions RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE ai_chat_messages RESTART IDENTITY CASCADE');
      await client.query('DELETE FROM daily_logs WHERE entry_type != $1', ['SYSTEM_CONFIG']);
      await client.query('DELETE FROM daily_financial_reports');
      await client.query('COMMIT');
      res.json({ success: true, message: 'Đã dọn dẹp toàn bộ dữ liệu kiểm thử' });
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError; // Ném lỗi ra ngoài catch tổng
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Lỗi reset system:", error);
    res.status(500).json({ error: 'Lỗi máy chủ khi reset system' });
  }
});"""

text = text.replace(old_block, new_block)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Transaction patch applied!")
