import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_functions = """
// ==========================================
// AI CHAT MODEL REPOSITORY (RBAC SECURE)
// ==========================================
/**
 * Lưu một tin nhắn mới vào cơ sở dữ liệu hội thoại
 */
async function saveChatMessage({ sessionId, role, content, toolCalls = null }) {
    const query = `
        INSERT INTO ai_chat_messages (session_id, role, content, tool_calls)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
    `;
    const values = [
        sessionId, 
        role, 
        content, 
        toolCalls ? JSON.stringify(toolCalls) : null
    ];
    
    const { rows } = await pool.query(query, values);
    return rows[0];
}

/**
 * Lấy lịch sử hội thoại chuẩn RBAC - Ngăn chặn đọc chéo Session
 */
async function getChatHistorySecure(sessionId, user) {
    // Thiết quân luật: Chỉ lấy tin nhắn nếu Session đó thuộc về User hoặc User có quyền All-Access
    const isGlobalUser = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'].includes(user.role) || 
                         (user.role === 'DEPARTMENT_HEAD' && user.department_code === 'MARKETING');

    let query = `
        SELECT m.id, m.role, m.content, m.tool_calls, m.created_at
        FROM ai_chat_messages m
        INNER JOIN ai_chat_sessions s ON m.session_id = s.id
        WHERE m.session_id = $1
    `;
    
    const values = [sessionId];

    if (!isGlobalUser) {
        // Nhóm Local: Khóa chết theo user_id tạo ra session đó
        query += ` AND s.user_id = $2`;
        values.push(user.id);
    }

    query += ` ORDER BY m.created_at ASC;`;

    const { rows } = await pool.query(query, values);
    return rows;
}

/**
 * Cập nhật context nén vào metadata của Session
 */
async function updateSessionMetadata(sessionId, metadataUpdate) {
    const query = `
        UPDATE ai_chat_sessions
        SET metadata = metadata || $2::jsonb
        WHERE id = $1
        RETURNING metadata;
    `;
    const { rows } = await pool.query(query, [sessionId, JSON.stringify(metadataUpdate)]);
    return rows[0]?.metadata;
}

"""

# We replace the old getConversationContext with the new functions + refactored getConversationContext
old_get_context = """/**
 * Láº¥y lá»‹ch sá»­ chat ngáº¯n háº¡n, cÃ³ bá» c Auth Check chá»‘ng ID Harvesting
 */
async function getConversationContext(sessionId, userId) {"""

if "getChatHistorySecure" not in content:
    content = content.replace("async function getConversationContext(sessionId, userId) {", new_functions + "async function getConversationContext(sessionId, userId) {")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Added AI Chat Model functions successfully!")
