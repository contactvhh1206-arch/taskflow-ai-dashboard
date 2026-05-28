-- ==============================================================================
-- DATABASE SCHEMA: TASKFLOW AI (Hệ Thống Quản Lý Công Việc)
-- Hỗ trợ kiến trúc Multi-facility & Phân quyền RBAC
-- ==============================================================================

-- 1. Bảng Cơ sở (Facilities)
CREATE TABLE facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- 2. Bảng Vai trò (Roles)
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL, -- SUPER_ADMIN, FACILITY_MANAGER, DEPT_HEAD
    description TEXT
);

-- 3. Bảng Người dùng (Users)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role_id INT REFERENCES roles(id),
    facility_id INT REFERENCES facilities(id), -- NULL nếu là Sếp tổng (Super Admin)
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bảng Công việc (Tasks)
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'todo', -- todo, in_progress, review, done
    urgency BOOLEAN DEFAULT FALSE,
    deadline TIMESTAMP,
    pic_id INT REFERENCES users(id), -- Người phụ trách (Person In Charge)
    facility_id INT REFERENCES facilities(id) NOT NULL, -- Task thuộc cơ sở nào
    created_by INT REFERENCES users(id),
    created_by_role VARCHAR(50), -- 'CEO', 'VCEO', 'MANAGER', etc.
    priority_level VARCHAR(50) DEFAULT 'PRIORITY', -- 'URGENT', 'PRIORITY'
    department_code VARCHAR(50),
    priority_stars INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Bảng Nhật ký nhắc việc AI (AI Ping Logs)
CREATE TABLE ai_ping_logs (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    message TEXT,
    pinged_at TIMESTAMP DEFAULT NOW()
);

-- 6. Bảng Chat trong Task (Contextual Task-Chat)
CREATE TABLE task_comments (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id),
    content TEXT NOT NULL,
    attachments JSONB, -- Lưu URL ảnh nghiệm thu
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- CƠ CHẾ BẢO MẬT CẤP ĐỘ DÒNG (ROW-LEVEL SECURITY - RLS) CHO CƠ SỞ DỮ LIỆU
-- Đảm bảo Quản lý cơ sở chỉ lấy được Data của cơ sở mình ở tầng Database (nếu dùng PostgreSQL)
-- ==============================================================================

-- Bật RLS trên bảng tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Tạo Policy cho Sếp Tổng / Tổng quản lý (Được xem toàn bộ)
CREATE POLICY super_admin_all_tasks ON tasks
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            JOIN roles r ON u.role_id = r.id 
            WHERE u.id = current_user_id() 
            AND r.name IN ('SUPER_ADMIN')
        )
    );

-- Tạo Policy cho Quản lý cơ sở (Chỉ xem task thuộc facility_id của mình)
CREATE POLICY facility_manager_own_tasks ON tasks
    FOR ALL
    USING (
        facility_id = (SELECT facility_id FROM users WHERE id = current_user_id())
    );

-- 7. Bảng Báo cáo Đầu giờ (Daily Check-ins)
CREATE TABLE daily_checkins (
    id SERIAL PRIMARY KEY,
    facility_id INT REFERENCES facilities(id) NOT NULL,
    user_id INT REFERENCES users(id) NOT NULL, -- Quản lý thực hiện check-in
    shift VARCHAR(10) DEFAULT 'Ca 1', -- Ca 1 hoặc Ca 2
    clocker_present INT DEFAULT 0, -- Số lượng Clocker đi làm
    clocker_absent_excused INT DEFAULT 0, -- Clocker nghỉ có phép
    clocker_absent_unexcused INT DEFAULT 0, -- Clocker nghỉ không phép
    ktv_present INT DEFAULT 0, -- Số lượng KTV đi làm
    ktv_ids_present TEXT, -- Mã số KTV đi làm
    ktv_absent_excused INT DEFAULT 0, -- KTV nghỉ có phép
    ktv_ids_absent_excused TEXT, -- Mã số KTV nghỉ có phép
    ktv_absent_unexcused INT DEFAULT 0, -- KTV nghỉ không phép
    ktv_ids_absent_unexcused TEXT, -- Mã số KTV nghỉ không phép
    machinery_ok BOOLEAN DEFAULT FALSE, -- Máy móc tốt
    cleaning_done BOOLEAN DEFAULT FALSE, -- Vệ sinh xong
    repair_needed TEXT, -- Thiết bị cần sửa chữa
    incidents TEXT, -- Sự cố phát sinh
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Policy cho check-in
ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY super_admin_all_checkins ON daily_checkins
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = current_user_id() AND r.name IN ('SUPER_ADMIN'))
    );
CREATE POLICY facility_manager_own_checkins ON daily_checkins
    FOR ALL USING (
        facility_id = (SELECT facility_id FROM users WHERE id = current_user_id())
    );

-- 8. Bảng Theo dõi Token AI (AI Token Tracking)
CREATE TABLE ai_token_usage_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    username VARCHAR(100),
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Policy cho bảng Token AI
ALTER TABLE ai_token_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY super_admin_all_tokens ON ai_token_usage_logs
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = current_user_id() AND r.name IN ('SUPER_ADMIN', 'ADMIN'))
    );

-- 9. Bảng Báo cáo Doanh thu Tài chính (Daily Financial Reports)
CREATE TABLE daily_financial_reports (
    id VARCHAR(50) PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_revenue NUMERIC DEFAULT 0,
    data JSONB, -- Lưu chi tiết doanh thu từng cơ sở
    created_by VARCHAR(100),
    timestamp BIGINT, -- Lưu timestamp epoch
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Policy cho bảng Doanh thu
ALTER TABLE daily_financial_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_all_reports ON daily_financial_reports
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = current_user_id() AND r.name IN ('SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'))
    );


-- 8. Bảng Bình luận (Task Comments)
CREATE TABLE IF NOT EXISTS task_comments (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
\n
-- 8. Bảng Phiên trò chuyện AI (AI Sessions)
CREATE TABLE ai_sessions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    chat_log JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- Performance Indexes
CREATE INDEX idx_tasks_dept ON tasks(department_code);
CREATE INDEX idx_reports_date ON daily_financial_reports(created_at);


-- ==========================================================
-- AI KNOWLEDGE BASE (RAG)
-- ==========================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS company_knowledge_base (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL, -- Nội dung text đã băm nhỏ (Chunk)
    embedding vector(1536), -- Vector nhúng chuẩn OpenAI
    source_type VARCHAR(50), -- Phân loại: 'DOCUMENT', 'BOSS_INSTRUCTION', 'STAFF_CHAT'
    metadata JSONB, -- Lưu thêm thông tin: file_name, user_id, role...
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tạo Index để search tốc độ cao (HNSW)
CREATE INDEX IF NOT EXISTS company_knowledge_base_embedding_idx 
ON company_knowledge_base USING hnsw (embedding vector_cosine_ops);
