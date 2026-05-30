import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace user message saving
old_save_user = """        if (session_id) {
            const checkSession = await pool.query("SELECT id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2", [session_id, req.user.id]);
            if (checkSession.rowCount === 0) return res.status(403).json({ error: "Lỗi phiên làm việc." });
            
            try {
                const saveUserMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`;
                await pool.query(saveUserMsgSql, [session_id, userMessage]);
            } catch (err) {
                console.warn("Failed to save user chat message: Table missing", err.message);
            }
        }"""
new_save_user = """        if (session_id) {
            const checkSession = await pool.query("SELECT id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2", [session_id, req.user.id]);
            if (checkSession.rowCount === 0) return res.status(403).json({ error: "Lỗi phiên làm việc." });
            
            try {
                await saveChatMessage({ sessionId: session_id, role: 'user', content: userMessage });
            } catch (err) {
                console.warn("Failed to save user chat message", err.message);
            }
        }"""
content = content.replace(old_save_user, new_save_user)

# Replace getConversationContext usage
old_history = """        let chatHistory = [];
        if (session_id) {
            chatHistory = await getConversationContext(session_id, req.user.id);
        }"""
new_history = """        let chatHistory = [];
        if (session_id) {
            try {
                const rows = await getChatHistorySecure(session_id, req.user);
                // Map cho AI format
                chatHistory = rows.map(r => {
                    const msg = { role: r.role, content: r.content };
                    if (r.tool_calls) msg.tool_calls = r.tool_calls;
                    return msg;
                });
            } catch (err) {
                console.warn("Lỗi getChatHistorySecure:", err.message);
            }
        }"""
content = content.replace(old_history, new_history)

# Replace AI message saving (NHẬP 4: LƯU DB & GHI LOG BẢO MẬT)
old_save_ai = """        // ==========================================
        // NHáº¬P 4: LÆ¯U DB & GHI LOG Báº¢O Máº¬T
        // ==========================================
        if (session_id && aiReplyContent) {
            try {
                const saveAiMsgSql = `INSERT INTO ai_chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`;
                await pool.query(saveAiMsgSql, [session_id, aiReplyContent]);
            } catch (innerErr) {
                console.error("Lỗi lưu tin nhắn AI vào DB:", innerErr.message);
            }
        }

        if (promptTokens > 0 || completionTokens > 0) {
            const totalTokens = promptTokens + completionTokens;
            // Ghi log token vào đúng phiên chat hiện tại
            try {
                await pool.query(
                    `UPDATE ai_chat_sessions 
                     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{tokens}', jsonb_build_object('total', $1::int))
                     WHERE id = $2`,
                    [totalTokens, session_id]
                );
            } catch (metaErr) {
                console.error("Lỗi cập nhật metadata token:", metaErr.message);
            }
        }"""
new_save_ai = """        // ==========================================
        // NHẬP 4: LƯU DB & GHI LOG BẢO MẬT
        // ==========================================
        if (session_id && (aiReplyContent || Object.keys(toolCallsMap).length > 0)) {
            try {
                let toolCalls = null;
                if (Object.keys(toolCallsMap).length > 0) {
                     toolCalls = Object.values(toolCallsMap).map(tc => ({
                         id: tc.id,
                         type: "function",
                         function: { name: tc.name, arguments: tc.arguments }
                     }));
                }
                
                await saveChatMessage({ 
                     sessionId: session_id, 
                     role: 'assistant', 
                     content: aiReplyContent || "",
                     toolCalls: toolCalls
                });
                
                if (toolCalls && typeof toolResultStr !== 'undefined' && typeof mappedToolCallsForHistory !== 'undefined') {
                     for (const tc of mappedToolCallsForHistory) {
                         await saveChatMessage({
                             sessionId: session_id,
                             role: 'tool',
                             content: toolResultStr, // The JSON result
                             toolCalls: { tool_call_id: tc.id, name: tc.function.name } // Luu vet tool call id
                         });
                     }
                }
            } catch (innerErr) {
                console.error("Lỗi lưu tin nhắn AI vào DB:", innerErr.message);
            }
        }

        if (promptTokens > 0 || completionTokens > 0) {
            const totalTokens = promptTokens + completionTokens;
            try {
                await updateSessionMetadata(session_id, { tokens: { total: totalTokens } });
            } catch (metaErr) {
                console.error("Lỗi cập nhật metadata token:", metaErr.message);
            }
        }"""

# handle Vietnamese charset encoding issues with NHẬP 4 block
if "NHáº¬P 4: LÆ¯U DB & GHI LOG Báº¢O Máº¬T" in content:
    content = content.replace(old_save_ai, new_save_ai)
else:
    # Try Regex replacement just in case
    pattern_save_ai = re.compile(r'// ==========================================\s*// NH.*?4: L.*?U DB & GHI LOG B.*?O M.*?T\s*// ==========================================\s*if \(session_id && aiReplyContent\) \{.*?\}(?=\s*\}\s*catch \((error|err)\))', re.DOTALL)
    content = pattern_save_ai.sub(new_save_ai, content)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Refactored API endpoint to use Model functions.")
