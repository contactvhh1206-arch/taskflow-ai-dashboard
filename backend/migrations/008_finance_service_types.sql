-- Phân biệt "vé" với "dịch vụ" trong cột Loại vé của sheet VÉ.
-- Dịch vụ (vd MS = massage chân ở PQ, ghi số tiền tổng; LG = dịch vụ phụ kèm vé ở PA, PAV):
-- vẫn tính vào doanh thu nhưng không đếm vào số vé/khách và không cần giá niêm yết.
ALTER TABLE finance_ticket_prices ALTER COLUMN list_price DROP NOT NULL;
ALTER TABLE finance_ticket_prices ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'ticket'; -- ticket | service
ALTER TABLE finance_ticket_prices ADD COLUMN IF NOT EXISTS name TEXT;

INSERT INTO finance_ticket_prices (ticket_type, list_price, kind, name) VALUES
    ('MS', NULL, 'service', 'Massage chân (PQ)'),
    ('LG', NULL, 'service', 'Dịch vụ phụ kèm vé (PA, PAV)')
ON CONFLICT (ticket_type) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, list_price = NULL, updated_at = NOW();
