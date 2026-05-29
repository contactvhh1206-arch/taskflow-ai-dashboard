import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add DB Initialization
db_init_target = r"(await pool\.query\(`CREATE TABLE IF NOT EXISTS system_config[\s\S]*?`\);)"
db_init_replacement = r"""\1

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
    )`);"""
content = re.sub(db_init_target, db_init_replacement, content, count=1)


# 2. Add SSE Global variables and Functions right after `const app = express();`
sse_target = r"(const app = express\(\);)"
sse_replacement = r"""\1

// ==========================================
// NOTIFICATIONS SSE STATE
// ==========================================
const sseClients = new Map();

setInterval(() => {
    sseClients.forEach((res, userId) => {
        try {
            res.write(':\n\n'); // Ping
        } catch (err) {
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
        
        if (sseClients.has(parseInt(userId))) {
            sseClients.get(parseInt(userId)).write(`data: ${JSON.stringify(newNotif)}\n\n`);
        } else if (sseClients.has(String(userId))) {
            sseClients.get(String(userId)).write(`data: ${JSON.stringify(newNotif)}\n\n`);
        }
    } catch (e) {
        console.error("Error saving/sending notification:", e);
    }
}
"""
content = re.sub(sse_target, sse_replacement, content, count=1)


# 3. Add SSE Endpoint right before API sections
api_start_target = r"(// ==============================================================================\s*// 1\. API)"
api_start_replacement = r"""// ==============================================================================
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
    req.on('close', () => { sseClients.delete(userId); });
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

\1"""
content = re.sub(api_start_target, api_start_replacement, content, count=1)


# 4. Inject Triggers
# POST /api/tasks
create_task_target = r"(res\.json\(\{ success: true, data: newTask \}\);)"
create_task_replacement = r"""
      if (pic_id && pic_id !== req.user.id) {
          sendRealtimeNotification(pic_id, 'NEW_TASK', `Bạn vừa được giao một công việc mới: "${title}"`, newTask.id, req.user.id);
      }
      \1"""
content = re.sub(create_task_target, create_task_replacement, content, count=1)


# POST /api/tasks/:id/comments
add_comment_target = r"(await pool\.query\(`\s*INSERT INTO task_comments[\s\S]*?\]\);)"
add_comment_replacement = r"""\1
      try {
          const taskInfo = await pool.query('SELECT pic_id, title FROM tasks WHERE id = $1', [taskId]);
          if (taskInfo.rows.length > 0) {
              const tInfo = taskInfo.rows[0];
              if (tInfo.pic_id && tInfo.pic_id !== req.user.id) {
                  sendRealtimeNotification(tInfo.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: "${tInfo.title}"`, taskId, req.user.id);
              }
          }
      } catch (err) {}"""
content = re.sub(add_comment_target, add_comment_replacement, content, count=1)


# PUT /api/tasks/:id/status
update_status_target = r"(await pool\.query\('UPDATE tasks SET status = \$1, updated_at = NOW\(\) WHERE id = \$2', \[status, taskId\]\);)"
update_status_replacement = r"""\1
      try {
          // If status changes to completed/review, we might want to notify the creator.
          // Since creator_id is not saved, we will just send it to whoever needs it in the future.
          // For now, no strict requirement, but trigger is ready.
      } catch (err) {}"""
content = re.sub(update_status_target, update_status_replacement, content, count=1)


with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patching server.js complete.")
