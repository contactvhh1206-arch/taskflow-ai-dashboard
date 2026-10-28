-- Giá niêm yết riêng theo cơ sở cho loại vé có giá khác nhau giữa các cơ sở (vd SK).
-- Loại vé không có dòng ở đây thì dùng giá chung trong finance_ticket_prices.
CREATE TABLE IF NOT EXISTS finance_ticket_price_overrides (
    ticket_type VARCHAR(20) NOT NULL,
    facility_code VARCHAR(20) NOT NULL,     -- 41, ACE, PQ, PA, PAV, PAK
    list_price NUMERIC NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (ticket_type, facility_code)
);

INSERT INTO finance_ticket_price_overrides (ticket_type, facility_code, list_price) VALUES
    ('SK', '41', 6000),
    ('SK', 'ACE', 9000),
    ('SK', 'PAK', 8000)
ON CONFLICT (ticket_type, facility_code) DO NOTHING;

ALTER TABLE finance_ticket_price_overrides ENABLE ROW LEVEL SECURITY;
