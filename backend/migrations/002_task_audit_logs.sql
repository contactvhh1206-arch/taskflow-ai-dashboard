-- Migration: Tạo bảng task_audit_logs để lưu lịch sử task bị xóa cứng
-- Chạy một lần trên database production

CREATE TABLE IF NOT EXISTS task_audit_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    action VARCHAR(50) NOT NULL DEFAULT 'DELETED',
    deleted_by INTEGER NOT NULL,
    deleted_by_role VARCHAR(50),
    task_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_task_id ON task_audit_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON task_audit_logs(created_at DESC);
