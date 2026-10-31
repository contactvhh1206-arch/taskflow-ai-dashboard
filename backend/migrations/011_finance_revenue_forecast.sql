-- Dự đoán doanh thu: lưu bản dự đoán mỗi ngày để sau này so với số thật, và cài đặt mức "bằng".
-- Backend ghi qua kết nối Postgres trực tiếp nên bật RLS không kèm policy để chặn API công khai của Supabase.

CREATE TABLE IF NOT EXISTS finance_forecast_snapshots (
    made_on DATE NOT NULL,                   -- ngày làm dự đoán (giờ Việt Nam)
    target_month VARCHAR(7) NOT NULL,        -- 'YYYY-MM' được dự đoán
    facility_code VARCHAR(20) NOT NULL,      -- 41, ACE, PQ, PA, PAV, PAK hoặc ALL (toàn chuỗi)
    forecast NUMERIC NOT NULL,
    low NUMERIC NOT NULL,
    high NUMERIC NOT NULL,
    last_year NUMERIC,
    method VARCHAR(20) NOT NULL,             -- actual_run_rate | seasonal
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (made_on, target_month, facility_code)
);
CREATE INDEX IF NOT EXISTS idx_finance_forecast_snapshots_month ON finance_forecast_snapshots (target_month);

CREATE TABLE IF NOT EXISTS finance_forecast_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- chỉ có một dòng
    flat_band_pct NUMERIC NOT NULL DEFAULT 3,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO finance_forecast_settings (id, flat_band_pct) VALUES (1, 3) ON CONFLICT (id) DO NOTHING;

ALTER TABLE finance_forecast_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_forecast_settings ENABLE ROW LEVEL SECURITY;
