-- 1. Thêm cột metadata vào session hiện tại để lưu context nén
ALTER TABLE ai_chat_sessions 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Tạo bảng lưu trữ tin nhắn chi tiết
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,
    tool_calls JSONB, -- Bắt buộc để lưu vết việc gọi Tool, giúp AI không gọi lặp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Đánh Index để tối ưu tốc độ truy xuất luồng stream
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session 
ON ai_chat_messages(session_id, created_at ASC);
