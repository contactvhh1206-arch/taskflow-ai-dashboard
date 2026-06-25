ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb;
