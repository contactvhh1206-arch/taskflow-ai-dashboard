import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    text = f.read()

# ========================================================
# 1. API GET /api/reports (Nhiệm vụ 1: Bịt rò rỉ báo cáo)
# ========================================================
old_reports = '''    if (!['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'FACILITY_MANAGER'].includes(role)) {
      return res.status(403).json({ error: 'Không đủ quyền xem báo cáo tài chính.' });
    }
    const { rows } = await pool.query('SELECT * FROM daily_financial_reports ORDER BY date DESC');'''

new_reports = '''    if (!['SUPER_ADMIN', 'GENERAL_MANAGER', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'FACILITY_MANAGER'].includes(role)) {
      return res.status(403).json({ error: 'Không đủ quyền xem báo cáo tài chính.' });
    }
    
    let query = 'SELECT * FROM daily_financial_reports WHERE 1=1';
    const params = [];
    
    if (role === 'FACILITY_MANAGER') {
        params.push(req.user.facility_id);
        query += ` AND facility_id = $${params.length}`;
    }
    
    query += ' ORDER BY date DESC';
    const { rows } = await pool.query(query, params);'''

text = text.replace(old_reports, new_reports)

# ========================================================
# 2. SSE sendRealtimeNotification (Nhiệm vụ 2: Bịt rò rỉ Socket)
# ========================================================
old_sse = '''async function sendRealtimeNotification(userId, type, message, taskId = null, actorId = null) {
    if (!userId) return;
    try {
        const notifRes = await pool.query(`
            INSERT INTO notifications (user_id, task_id, type, message, actor_id)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [userId, taskId, type, message, actorId]);
        
        const newNotif = notifRes.rows[0];
        
        if (sseClients.has(parseInt(userId))) {
            sseClients.get(parseInt(userId)).write(`data: ${JSON.stringify(newNotif)}\\n\\n`);
        } else if (sseClients.has(String(userId))) {
            sseClients.get(String(userId)).write(`data: ${JSON.stringify(newNotif)}\\n\\n`);
        }
    } catch (e) {
        console.error("Error saving/sending notification:", e);
    }
}'''

new_sse = '''// HÀM PHÂN QUYỀN SSE BROADCAST
async function sendRealtimeNotification(taskId, type, message, actorId = null) {
    if (!taskId) return;
    try {
        const taskCheck = await pool.query('SELECT facility_id, department_code FROM tasks WHERE id = $1', [taskId]);
        if (taskCheck.rows.length === 0) return;
        const task = taskCheck.rows[0];

        // Lấy danh sách User hợp lệ (Sếp tổng/phó HOẶC trùng facility_id/department_code)
        const usersRes = await pool.query(`
            SELECT u.id 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE r.name IN ('SUPER_ADMIN', 'VICE_PRESIDENT')
               OR (u.facility_id = $1 AND $1 IS NOT NULL)
               OR (u.department_code = $2 AND $2 IS NOT NULL)
               OR (u.department_id = $2 AND $2 IS NOT NULL)
        `, [task.facility_id, task.department_code]);
        
        const allowedUserIds = usersRes.rows.map(r => r.id);
        
        for (const uid of allowedUserIds) {
            // Lưu DB Notifications
            const notifRes = await pool.query(`
                INSERT INTO notifications (user_id, task_id, type, message, actor_id)
                VALUES ($1, $2, $3, $4, $5) RETURNING *
            `, [uid, taskId, type, message, actorId]);
            const newNotif = notifRes.rows[0];

            // Bắn SSE an toàn đúng kênh
            if (sseClients.has(parseInt(uid))) {
                sseClients.get(parseInt(uid)).write(`data: ${JSON.stringify(newNotif)}\\n\\n`);
            } else if (sseClients.has(String(uid))) {
                sseClients.get(String(uid)).write(`data: ${JSON.stringify(newNotif)}\\n\\n`);
            }
        }
    } catch (e) {
        console.error("Error saving/sending secure notification:", e);
    }
}'''

text = text.replace(old_sse, new_sse)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("Patch applied for Reports and SSE.")
