ALTER TABLE daily_financial_reports ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb;
