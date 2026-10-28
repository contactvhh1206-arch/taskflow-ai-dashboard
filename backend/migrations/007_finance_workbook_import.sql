-- Nhập file tổng tháng của kế toán (TỔNG Txx.xlsx): vé theo loại + khuyến mãi, chi từng khoản,
-- hàng bán kèm (tinh dầu, khăn, đồ uống — chỉ để đối chiếu, không tính vào doanh thu).
-- Mỗi lần nhập thay toàn bộ dữ liệu của tháng đó. Backend ghi qua kết nối Postgres trực tiếp
-- nên bật RLS không kèm policy để chặn truy cập qua API công khai của Supabase.

CREATE TABLE IF NOT EXISTS finance_imports (
    id BIGSERIAL PRIMARY KEY,
    month VARCHAR(7) NOT NULL,              -- 'YYYY-MM'
    file_name TEXT,
    imported_by TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    summary JSONB DEFAULT '{}'::jsonb,      -- tổng theo cơ sở lúc nhập
    warnings JSONB DEFAULT '[]'::jsonb      -- cảnh báo của bộ đọc file
);
CREATE INDEX IF NOT EXISTS idx_finance_imports_month ON finance_imports (month, imported_at DESC);

-- Mỗi ngày × cơ sở
CREATE TABLE IF NOT EXISTS finance_daily (
    month VARCHAR(7) NOT NULL,
    date DATE NOT NULL,
    facility_code VARCHAR(20) NOT NULL,     -- 41, ACE, PQ, PA, PAV, PAK
    ticket_count INTEGER DEFAULT 0,
    guest_count INTEGER DEFAULT 0,
    ticket_revenue NUMERIC DEFAULT 0,       -- tổng "Tổng vé sau KM"
    expense NUMERIC DEFAULT 0,              -- tổng chi trong ngày
    card_amount NUMERIC DEFAULT 0,          -- quẹt thẻ
    addons JSONB DEFAULT '{}'::jsonb,       -- {"Tinh dầu": 30, "Khăn": 9, "Suối": 154, ...}
    import_id BIGINT REFERENCES finance_imports(id) ON DELETE SET NULL,
    PRIMARY KEY (date, facility_code)
);
CREATE INDEX IF NOT EXISTS idx_finance_daily_month ON finance_daily (month);

-- Vé gộp theo ngày × cơ sở × loại vé × mã KM × KM
CREATE TABLE IF NOT EXISTS finance_ticket_daily (
    month VARCHAR(7) NOT NULL,
    date DATE NOT NULL,
    facility_code VARCHAR(20) NOT NULL,
    ticket_type VARCHAR(20) NOT NULL,       -- C, D, D2, ... ('' nếu file không ghi)
    promo_code VARCHAR(50) NOT NULL DEFAULT '',  -- cột Code: CM, VIP, BD, GG, AT, AH...
    km VARCHAR(50) NOT NULL DEFAULT '',     -- cột KM nguyên văn: 20, 100, -200, CB, HH...
    km_kind VARCHAR(20) NOT NULL DEFAULT '',-- percent | amount | combo | commission | other | ''
    ticket_count INTEGER DEFAULT 0,
    guest_count INTEGER DEFAULT 0,
    revenue NUMERIC DEFAULT 0,
    free_count INTEGER DEFAULT 0,           -- vé thu 0 đồng
    import_id BIGINT REFERENCES finance_imports(id) ON DELETE SET NULL,
    PRIMARY KEY (date, facility_code, ticket_type, promo_code, km)
);
CREATE INDEX IF NOT EXISTS idx_finance_ticket_daily_month ON finance_ticket_daily (month);

-- Từng khoản chi
CREATE TABLE IF NOT EXISTS finance_expense_items (
    id BIGSERIAL PRIMARY KEY,
    month VARCHAR(7) NOT NULL,
    date DATE,
    facility_code VARCHAR(20) NOT NULL,
    description TEXT,
    amount NUMERIC DEFAULT 0,
    category TEXT,
    import_id BIGINT REFERENCES finance_imports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_expense_items_month ON finance_expense_items (month, facility_code);

-- Bảng giá niêm yết (chung mọi cơ sở) — để ước tính tiền đã giảm
CREATE TABLE IF NOT EXISTS finance_ticket_prices (
    ticket_type VARCHAR(20) PRIMARY KEY,
    list_price NUMERIC NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO finance_ticket_prices (ticket_type, list_price) VALUES
    ('C', 500), ('D', 900), ('D2', 1200), ('DD', 1500), ('B', 1700), ('SD', 1800), ('SB', 2200), ('K', 3000)
ON CONFLICT (ticket_type) DO NOTHING;

-- Tên chương trình khuyến mãi theo mã (kế toán thêm/sửa trên Hub)
CREATE TABLE IF NOT EXISTS finance_promo_codes (
    code VARCHAR(50) PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO finance_promo_codes (code, name) VALUES
    ('CM', 'Ứng dụng Camapro'),
    ('VIP', 'Thẻ quà tặng'),
    ('BD', 'Bóng đá'),
    ('GG', 'Quảng cáo Google Maps'),
    ('AT', 'Quản lý AT cho giảm'),
    ('AH', 'Quản lý AH cho giảm')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE finance_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ticket_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ticket_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_promo_codes ENABLE ROW LEVEL SECURITY;
