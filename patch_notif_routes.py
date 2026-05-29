import sys

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target = "app.post('/api/tasks', authenticateUser"

replacement = """
// ==========================================
// NOTIFICATIONS API
// ==========================================
app.get('/api/notifications', authenticateUser, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
            [req.user.id]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi tải thông báo' });
    }
});

app.get('/api/notifications/stream', authenticateUser, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const clientId = req.user.id;
    sseClients.set(clientId, res);

    res.write(':\\n\\n'); // Ping

    req.on('close', () => {
        sseClients.delete(clientId);
    });
});

app.put('/api/notifications/:id/read', authenticateUser, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi cập nhật' });
    }
});

app.post('/api/tasks', authenticateUser"""

if target in content:
    content = content.replace(target, replacement)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Inserted Notification API routes")
