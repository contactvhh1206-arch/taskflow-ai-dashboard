-- [Migration 005] Trí nhớ dài hạn toàn cục cho Cố vấn AI

-- Thêm cột đánh dấu session đã được AI học chưa
ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS learning_processed BOOLEAN DEFAULT false;

-- Tạo bảng lưu tri thức AI tự trích xuất từ các cuộc hội thoại
CREATE TABLE IF NOT EXISTS ai_learned_insights (
    id SERIAL PRIMARY KEY,

    -- Nội dung bài học
    insight_text TEXT NOT NULL,

    -- Vector embedding (text-embedding-3-small = 1536 chiều)
    embedding vector(1536),

    -- Phân loại bài học:
    --   'operations' : vận hành, nhân sự, ca làm, thiết bị
    --   'revenue'    : doanh thu, KPI, phương án kinh doanh
    --   'directive'  : chỉ thị trực tiếp từ sếp -> áp dụng toàn hệ thống
    --   'incident'   : sự cố, xử lý khẩn cấp
    --   'preference' : thói quen/sở thích của user
    category VARCHAR(50) NOT NULL DEFAULT 'operations',

    -- Mức độ quan trọng (AI tự đánh giá khi trích xuất, 1-10)
    importance SMALLINT DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),

    -- Nguồn gốc bài học
    source_session_id VARCHAR(255),
    source_user_id INTEGER,
    source_facility_id INTEGER,

    -- Metadata mở rộng
    metadata JSONB DEFAULT '{}',

    -- Thời gian tạo
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Soft delete: vô hiệu hóa bài học lỗi thời thay vì xóa
    is_active BOOLEAN DEFAULT true
);

-- Index HNSW cho semantic search cực nhanh (giống company_knowledge_base)
CREATE INDEX IF NOT EXISTS idx_ai_learned_insights_vector
    ON ai_learned_insights USING hnsw (embedding vector_cosine_ops);

-- Index lọc theo category + is_active
CREATE INDEX IF NOT EXISTS idx_ai_learned_insights_category
    ON ai_learned_insights (category, is_active);

-- Index lọc theo facility
CREATE INDEX IF NOT EXISTS idx_ai_learned_insights_facility
    ON ai_learned_insights (source_facility_id);
