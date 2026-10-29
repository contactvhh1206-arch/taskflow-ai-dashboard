-- Cài đặt đối chiếu (giá niêm yết, dịch vụ, giá riêng theo cơ sở, mã khuyến mãi) tách theo THÁNG:
-- sửa tháng 11 không làm đổi giảm ước tính / tên chương trình của tháng 10.
-- Tháng chưa có cài đặt riêng dùng tháng gần nhất trước đó (finance_config_months);
-- khi nhập file một tháng mới, backend sao chép cài đặt đó thành bản riêng của tháng.
-- Cài đặt đang có được gán cho 2026-10 (tháng duy nhất đã nhập file tổng).
-- CHẠY MỘT LẦN (đổi khóa chính).

CREATE TABLE IF NOT EXISTS finance_config_months (
    month VARCHAR(7) PRIMARY KEY,            -- 'YYYY-MM' có bộ cài đặt riêng
    copied_from VARCHAR(7),                  -- tháng nguồn khi được sao chép tự động
    created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO finance_config_months (month) VALUES ('2026-10') ON CONFLICT (month) DO NOTHING;

ALTER TABLE finance_ticket_prices ADD COLUMN IF NOT EXISTS month VARCHAR(7);
UPDATE finance_ticket_prices SET month = '2026-10' WHERE month IS NULL;
ALTER TABLE finance_ticket_prices ALTER COLUMN month SET NOT NULL;
ALTER TABLE finance_ticket_prices DROP CONSTRAINT IF EXISTS finance_ticket_prices_pkey;
ALTER TABLE finance_ticket_prices ADD PRIMARY KEY (month, ticket_type);

ALTER TABLE finance_promo_codes ADD COLUMN IF NOT EXISTS month VARCHAR(7);
UPDATE finance_promo_codes SET month = '2026-10' WHERE month IS NULL;
ALTER TABLE finance_promo_codes ALTER COLUMN month SET NOT NULL;
ALTER TABLE finance_promo_codes DROP CONSTRAINT IF EXISTS finance_promo_codes_pkey;
ALTER TABLE finance_promo_codes ADD PRIMARY KEY (month, code);

ALTER TABLE finance_ticket_price_overrides ADD COLUMN IF NOT EXISTS month VARCHAR(7);
UPDATE finance_ticket_price_overrides SET month = '2026-10' WHERE month IS NULL;
ALTER TABLE finance_ticket_price_overrides ALTER COLUMN month SET NOT NULL;
ALTER TABLE finance_ticket_price_overrides DROP CONSTRAINT IF EXISTS finance_ticket_price_overrides_pkey;
ALTER TABLE finance_ticket_price_overrides ADD PRIMARY KEY (month, ticket_type, facility_code);

ALTER TABLE finance_config_months ENABLE ROW LEVEL SECURITY;
