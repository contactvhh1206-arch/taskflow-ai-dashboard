import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Insert checkAdmin before GET /api/users/directory
checkAdmin_code = """
const checkAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: "403 Forbidden: Quyền lực này chỉ dành cho Kẻ Gác Đền (ADMIN)!" });
    }
    next();
};

app.get('/api/users/directory'"""
text = text.replace("app.get('/api/users/directory'", checkAdmin_code)

# 2. Lock POST, PUT, DELETE /api/users
text = text.replace("app.post('/api/users', async (req, res) => {", "app.post('/api/users', authenticateUser, checkAdmin, async (req, res) => {")
text = text.replace("app.put('/api/users/:id', async (req, res) => {", "app.put('/api/users/:id', authenticateUser, checkAdmin, async (req, res) => {")
text = text.replace("app.delete('/api/users/:id', async (req, res) => {", "app.delete('/api/users/:id', authenticateUser, checkAdmin, async (req, res) => {")

# 3. Lock GET /api/config
text = text.replace("app.get('/api/config', async (req, res) => {", "app.get('/api/config', authenticateUser, checkAdmin, async (req, res) => {")

# 4. Lock /api/ai routes
text = text.replace("app.get('/api/ai/sessions', authenticateUser, async (req, res) => {", "app.get('/api/ai/sessions', authenticateUser, checkAdmin, async (req, res) => {")
text = text.replace("app.post('/api/ai/sessions', authenticateUser, async (req, res) => {", "app.post('/api/ai/sessions', authenticateUser, checkAdmin, async (req, res) => {")
text = text.replace("app.get('/api/ai/violations', authenticateUser, async (req, res) => {", "app.get('/api/ai/violations', authenticateUser, checkAdmin, async (req, res) => {")
text = text.replace("app.post('/api/ai/violations', authenticateUser, async (req, res) => {", "app.post('/api/ai/violations', authenticateUser, checkAdmin, async (req, res) => {")

# 5. Add /api/rag/upload (Place it right before /api/ai/auto-tasking)
rag_code = """
app.post('/api/rag/upload', authenticateUser, checkAdmin, (req, res) => {
    return res.json({ message: "Hệ thống RAG Backend đang được CTO thiết kế kiến trúc. Vui lòng quay lại sau!" });
});

app.post('/api/ai/auto-tasking'"""
text = text.replace("app.post('/api/ai/auto-tasking'", rag_code)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Security patch applied!")
