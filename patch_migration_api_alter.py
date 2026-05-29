import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(
    """app.get('/api/dev/migrate-departments', async (req, res) => {
    try {
        await pool.query(`
            UPDATE tasks """,
    """app.get('/api/dev/migrate-departments', async (req, res) => {
    try {
        // Fix for "column does not exist" error
        await pool.query(`
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS department_code VARCHAR(50);
        `);
        
        await pool.query(`
            UPDATE tasks """
)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("Migration API patched with ALTER TABLE.")
