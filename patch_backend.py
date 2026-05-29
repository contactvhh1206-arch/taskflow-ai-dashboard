import sys

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add DB Initialization
db_init_target = """    await pool.query(`CREATE TABLE IF NOT EXISTS system_config (
        key VARCHAR(255) PRIMARY KEY,
        data JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);"""

db_init_replacement = db_init_target + """
    
    // Notifications table
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        actor_id INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);
"""

if db_init_target in content:
    content = content.replace(db_init_target, db_init_replacement)
else:
    print("Could not find db_init_target")

# 2. Add SSE Global variables and Functions right after `const app = express();`
sse_target = "const app = express();"
sse_replacement = sse_target + """

// ==========================================
// NOTIFICATIONS SSE STATE
// ==========================================
const sseClients = new Map(); // Map<userId, res>

// Heartbeat to prevent Render from closing connection
setInterval(() => {
    sseClients.forEach((res, userId) => {
        try {
            res.write(':\\n\\n'); // Ping
        } catch (err) {
            console.error(`Error sending heartbeat to user ${userId}:`, err);
            sseClients.delete(userId);
        }
    });
}, 15000);

async function sendRealtimeNotification(userId, type, message, taskId = null, actorId = null) {
    if (!userId) return;
    try {
        const notifRes = await pool.query(`
            INSERT INTO notifications (user_id, task_id, type, message, actor_id)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [userId, taskId, type, message, actorId]);
        
        const newNotif = notifRes.rows[0];
        
        // Push to client if online
        if (sseClients.has(parseInt(userId))) {
            const res = sseClients.get(parseInt(userId));
            res.write(`data: ${JSON.stringify(newNotif)}\\n\\n`);
        } else if (sseClients.has(String(userId))) {
            const res = sseClients.get(String(userId));
            res.write(`data: ${JSON.stringify(newNotif)}\\n\\n`);
        }
    } catch (e) {
        console.error("Error saving/sending notification:", e);
    }
}
"""

if sse_target in content:
    content = content.replace(sse_target, sse_replacement)
else:
    print("Could not find sse_target")

# 3. Add SSE Endpoint right after app.use('/api/*', ...) or just before API definitions
api_start_target = "// 1. API NGƯỜI DÙNG & XÁC THỰC"
if api_start_target not in content:
    api_start_target = "// 1. API"

api_start_replacement = """// ==============================================================================
// 0. API SSE NOTIFICATIONS
// ==============================================================================
app.get('/api/notifications/stream', authenticateUser, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const userId = req.user.id;
    if (!userId) {
        res.status(401).end();
        return;
    }

    sseClients.set(userId, res);
    
    // Cleanup on disconnect
    req.on('close', () => {
        sseClients.delete(userId);
    });
});

app.get('/api/notifications', authenticateUser, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi tải thông báo.' });
    }
});

app.put('/api/notifications/:id/read', authenticateUser, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi đánh dấu đã đọc.' });
    }
});

""" + api_start_target

if api_start_target in content:
    content = content.replace(api_start_target, api_start_replacement)
else:
    print("Could not find api_start_target")


# 4. Inject Triggers

# Create task trigger
create_task_target = "res.json({ success: true, data: newTask });"
create_task_replacement = """
      // [NOTIFICATIONS TRIGGER]
      if (pic_id && pic_id !== req.user.id) {
          sendRealtimeNotification(pic_id, 'NEW_TASK', `Bạn vừa được giao một công việc mới: "${title}"`, newTask.id, req.user.id);
      }
      
      res.json({ success: true, data: newTask });"""

if create_task_target in content:
    content = content.replace(create_task_target, create_task_replacement)
else:
    print("Could not find create_task_target")


# Update status trigger
update_status_target = "res.json({ success: true, message: 'Cập nhật trạng thái thành công' });"
if update_status_target not in content:
    update_status_target = "res.json({ success: true, message: 'C?p nh?t tr?ng thi thnh cng' });" # UTF-8 mangled version
update_status_replacement = """
      // [NOTIFICATIONS TRIGGER]
      // Try to find the creator of the task (or at least notify some relevant person)
      // Since creator_id doesn't exist, we skip precise targeting for now or log it.
      
      res.json({ success: true, message: 'Cập nhật trạng thái thành công' });"""

if update_status_target in content:
    content = content.replace(update_status_target, update_status_replacement)
else:
    print("Could not find update_status_target")


# Add comment trigger
add_comment_target = "res.json({ success: true, message: 'Thêm bình luận thành công' });"
if add_comment_target not in content:
    add_comment_target = "res.json({ success: true, message: 'Thm bnh lu?n thnh cng' });"

add_comment_replacement = """
      // [NOTIFICATIONS TRIGGER]
      try {
          const taskInfo = await pool.query('SELECT pic_id, title FROM tasks WHERE id = $1', [taskId]);
          if (taskInfo.rows.length > 0) {
              const tInfo = taskInfo.rows[0];
              if (tInfo.pic_id && tInfo.pic_id !== req.user.id) {
                  sendRealtimeNotification(tInfo.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: "${tInfo.title}"`, taskId, req.user.id);
              }
          }
      } catch (err) { console.error("Notification comment err:", err); }

      res.json({ success: true, message: 'Thêm bình luận thành công' });"""

if add_comment_target in content:
    content = content.replace(add_comment_target, add_comment_replacement)
else:
    print("Could not find add_comment_target")


with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patching server.js complete.")
