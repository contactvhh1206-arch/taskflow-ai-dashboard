import re

with open('agent/rules/stitch_smart_ai_task_management_system/src/services/dataService.js', 'r', encoding='utf-8') as f:
    content = f.read()

stream_func = """
export const streamAIChat = async (message, sessionId, token, onChunk, onDone, onError) => {
    try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com'}/api/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Bắt buộc truyền Token JWT từ Context
            },
            body: JSON.stringify({ message, session_id: sessionId })
        });

        if (!response.ok) throw new Error("Lỗi kết nối hệ thống AI.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (onDone) onDone();
                break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            // Dùng \\n chuẩn xác để split chunk
            const lines = chunk.split('\\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const parsed = JSON.parse(line.substring(6));
                        if (parsed.content && onChunk) {
                            onChunk(parsed.content); // Bắn chữ về UI
                        } else if (parsed.error && onError) {
                            onError(parsed.error);
                        }
                    } catch (e) {
                        // Bỏ qua lỗi parse dở dang của luồng Stream
                    }
                }
            }
        }
    } catch (error) {
        console.error("Lỗi streamAIChat:", error);
        if (onError) onError(error);
    }
};
"""

if "export const streamAIChat" not in content:
    with open('agent/rules/stitch_smart_ai_task_management_system/src/services/dataService.js', 'a', encoding='utf-8') as f:
        f.write("\n" + stream_func)

print("streamAIChat added to dataService.js")
