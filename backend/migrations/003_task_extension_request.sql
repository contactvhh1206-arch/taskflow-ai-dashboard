-- Migration: Thêm cột extension_requested và extension_reason vào bảng tasks
-- Mục đích: Cho phép PIC xin gia hạn deadline, hiển thị chờ duyệt ở Tổng quan BĐH

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS extension_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS extension_reason TEXT;

COMMENT ON COLUMN tasks.extension_requested IS 'Cờ đánh dấu PIC đã gửi yêu cầu xin gia hạn deadline';
COMMENT ON COLUMN tasks.extension_reason IS 'Nguyên nhân/lý do PIC xin gia hạn deadline';
