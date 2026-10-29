const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');
const requireRoles = require('../middlewares/requireRoles');

// Nhập file tổng tháng (TỔNG Txx.xlsx). Frontend đọc file và gửi dữ liệu đã bóc tách;
// backend chỉ kiểm tra hình dạng rồi thay toàn bộ dữ liệu tháng đó trong một transaction.
// Cần migration 007_finance_workbook_import.sql.
const WRITE_ROLES = ['FINANCE_DEPT', 'SUPER_ADMIN'];
// Khớp quyền mở tab "Tổng quan doanh thu" ở frontend
const READ_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const badRequest = (res, error) => res.status(400).json({ success: false, error });

// --- Cài đặt đối chiếu theo THÁNG (migration 010_finance_config_per_month.sql) ---
// Mỗi tháng có bộ riêng: giá niêm yết / dịch vụ, giá riêng theo cơ sở, mã khuyến mãi.
// Tháng chưa có bộ riêng dùng tháng gần nhất trước đó (nếu không có thì tháng sớm nhất).
const resolveConfigMonth = async (db, month) => {
    const before = await db.query('SELECT month FROM finance_config_months WHERE month <= $1 ORDER BY month DESC LIMIT 1', [month]);
    if (before.rows[0]) return before.rows[0].month;
    const after = await db.query('SELECT month FROM finance_config_months ORDER BY month ASC LIMIT 1');
    return after.rows[0]?.month || null;
};

const loadConfig = async (db, month) => {
    const sourceMonth = await resolveConfigMonth(db, month);
    if (!sourceMonth) return { month, sourceMonth: null, prices: [], promoCodes: [], priceOverrides: [] };
    const [prices, codes, overrides] = await Promise.all([
        db.query(`SELECT ticket_type, list_price, kind, name FROM finance_ticket_prices WHERE month = $1
                  ORDER BY kind DESC, list_price NULLS LAST, ticket_type`, [sourceMonth]),
        db.query('SELECT code, name FROM finance_promo_codes WHERE month = $1 ORDER BY code', [sourceMonth]),
        db.query(`SELECT ticket_type, facility_code, list_price FROM finance_ticket_price_overrides WHERE month = $1
                  ORDER BY ticket_type, facility_code`, [sourceMonth]),
    ]);
    return { month, sourceMonth, prices: prices.rows, promoCodes: codes.rows, priceOverrides: overrides.rows };
};

// Tạo bộ cài đặt riêng cho tháng bằng cách sao chép từ tháng nguồn (nếu tháng chưa có). Gọi trong transaction.
const ensureOwnConfig = async (client, month) => {
    const own = await client.query('SELECT 1 FROM finance_config_months WHERE month = $1', [month]);
    if (own.rows.length) return;
    const src = await resolveConfigMonth(client, month);
    await client.query('INSERT INTO finance_config_months (month, copied_from) VALUES ($1, $2)', [month, src]);
    if (!src) return;
    await client.query(
        `INSERT INTO finance_ticket_prices (month, ticket_type, list_price, kind, name, updated_at)
         SELECT $1, ticket_type, list_price, kind, name, NOW() FROM finance_ticket_prices WHERE month = $2`, [month, src]);
    await client.query(
        `INSERT INTO finance_promo_codes (month, code, name, updated_at)
         SELECT $1, code, name, NOW() FROM finance_promo_codes WHERE month = $2`, [month, src]);
    await client.query(
        `INSERT INTO finance_ticket_price_overrides (month, ticket_type, facility_code, list_price, updated_at)
         SELECT $1, ticket_type, facility_code, list_price, NOW() FROM finance_ticket_price_overrides WHERE month = $2`, [month, src]);
};

router.get('/config', authGuard, requireRoles(...READ_ROLES), async (req, res) => {
    const { month } = req.query;
    if (!MONTH_RE.test(month || '')) return badRequest(res, 'Tháng phải có dạng YYYY-MM');
    try {
        res.json({ success: true, data: await loadConfig(pool, month) });
    } catch (e) {
        console.error('Lỗi GET /api/finance/config:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Lưu = thay toàn bộ cài đặt của đúng tháng đó (tháng khác không đổi)
router.put('/config', authGuard, requireRoles(...WRITE_ROLES), async (req, res) => {
    const { month, prices = [], promoCodes = [], priceOverrides = [] } = req.body || {};
    if (!MONTH_RE.test(month || '')) return badRequest(res, 'Tháng phải có dạng YYYY-MM');
    if (!Array.isArray(prices)) return badRequest(res, 'prices phải là mảng');
    if (!Array.isArray(promoCodes)) return badRequest(res, 'promoCodes phải là mảng');
    if (!Array.isArray(priceOverrides)) return badRequest(res, 'priceOverrides phải là mảng');
    for (const o of priceOverrides) {
        if (!o.ticket_type || !o.facility_code || o.list_price === null || o.list_price === '' || !(Number(o.list_price) >= 0)) {
            return badRequest(res, `Giá riêng không hợp lệ: ${JSON.stringify(o)}`);
        }
    }
    for (const p of prices) {
        const kind = p.kind || 'ticket';
        const priceOk = kind === 'service'
            ? (p.list_price === null || p.list_price === undefined || p.list_price === '' || Number(p.list_price) >= 0)
            : Number(p.list_price) >= 0 && p.list_price !== null && p.list_price !== '';
        if (!p.ticket_type || !['ticket', 'service'].includes(kind) || !priceOk) {
            return badRequest(res, `Loại vé/dịch vụ không hợp lệ: ${JSON.stringify(p)}`);
        }
    }
    for (const c of promoCodes) {
        if (!c.code || !c.name) return badRequest(res, `Mã KM không hợp lệ: ${JSON.stringify(c)}`);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('INSERT INTO finance_config_months (month) VALUES ($1) ON CONFLICT (month) DO NOTHING', [month]);
        for (const table of ['finance_ticket_prices', 'finance_promo_codes', 'finance_ticket_price_overrides']) {
            await client.query(`DELETE FROM ${table} WHERE month = $1`, [month]);
        }
        for (const p of prices) {
            await client.query(
                `INSERT INTO finance_ticket_prices (month, ticket_type, list_price, kind, name, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (month, ticket_type) DO UPDATE
                 SET list_price = EXCLUDED.list_price, kind = EXCLUDED.kind, name = EXCLUDED.name, updated_at = NOW()`,
                [
                    month,
                    String(p.ticket_type).trim().toUpperCase(),
                    p.list_price === null || p.list_price === undefined || p.list_price === '' ? null : Number(p.list_price),
                    p.kind || 'ticket',
                    p.name ? String(p.name).trim() : null,
                ]
            );
        }
        for (const c of promoCodes) {
            await client.query(
                `INSERT INTO finance_promo_codes (month, code, name, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (month, code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
                [month, String(c.code).trim().toUpperCase(), String(c.name).trim()]
            );
        }
        for (const o of priceOverrides) {
            await client.query(
                `INSERT INTO finance_ticket_price_overrides (month, ticket_type, facility_code, list_price, updated_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (month, ticket_type, facility_code) DO UPDATE SET list_price = EXCLUDED.list_price, updated_at = NOW()`,
                [month, String(o.ticket_type).trim().toUpperCase(), String(o.facility_code).trim().toUpperCase(), Number(o.list_price)]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Lỗi PUT /api/finance/config:', e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        client.release();
    }
});

router.get('/months', authGuard, requireRoles(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT ON (month) month, id, file_name, imported_by, imported_at
             FROM finance_imports ORDER BY month DESC, imported_at DESC`
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('Lỗi GET /api/finance/months:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/month', authGuard, requireRoles(...READ_ROLES), async (req, res) => {
    const { month } = req.query;
    if (!MONTH_RE.test(month || '')) return badRequest(res, 'Tháng phải có dạng YYYY-MM');
    try {
        const [daily, tickets, expenses, imports] = await Promise.all([
            pool.query(
                `SELECT to_char(date, 'YYYY-MM-DD') AS date, facility_code, ticket_count, guest_count,
                        ticket_revenue::float AS ticket_revenue, expense::float AS expense,
                        card_amount::float AS card_amount, addons
                 FROM finance_daily WHERE month = $1 ORDER BY date, facility_code`, [month]),
            pool.query(
                `SELECT to_char(date, 'YYYY-MM-DD') AS date, facility_code, ticket_type, promo_code, km, km_kind,
                        ticket_count, guest_count, revenue::float AS revenue, free_count
                 FROM finance_ticket_daily WHERE month = $1 ORDER BY date, facility_code, ticket_type`, [month]),
            pool.query(
                `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, facility_code, description, amount::float AS amount, category
                 FROM finance_expense_items WHERE month = $1 ORDER BY date, facility_code, id`, [month]),
            pool.query(
                `SELECT id, file_name, imported_by, imported_at, summary, warnings
                 FROM finance_imports WHERE month = $1 ORDER BY imported_at DESC LIMIT 10`, [month]),
        ]);
        res.json({
            success: true,
            data: { daily: daily.rows, tickets: tickets.rows, expenses: expenses.rows, imports: imports.rows },
        });
    } catch (e) {
        console.error('Lỗi GET /api/finance/month:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/import', authGuard, requireRoles(...WRITE_ROLES), async (req, res) => {
    const { month, fileName, importedBy, summary, warnings, facilities, daily, tickets, expenses, reports } = req.body || {};
    if (!MONTH_RE.test(month || '')) return badRequest(res, 'Tháng phải có dạng YYYY-MM');
    if (!Array.isArray(facilities) || facilities.length === 0) return badRequest(res, 'Thiếu danh sách cơ sở');
    for (const [name, arr] of [['daily', daily], ['tickets', tickets], ['expenses', expenses], ['reports', reports]]) {
        if (!Array.isArray(arr)) return badRequest(res, `${name} phải là mảng`);
    }
    // Mọi dòng phải thuộc đúng tháng đang nhập và đúng cơ sở có trong file
    const inMonth = (d) => DATE_RE.test(d || '') && d.startsWith(month);
    const facSet = new Set(facilities);
    for (const [name, arr] of [['daily', daily], ['tickets', tickets], ['expenses', expenses]]) {
        const bad = arr.find(r => !inMonth(r.date) || !facSet.has(r.facility_code));
        if (bad) return badRequest(res, `Dòng ${name} sai tháng hoặc cơ sở: ${JSON.stringify(bad).slice(0, 200)}`);
    }
    const badReport = reports.find(r => !inMonth(r.date) || !Array.isArray(r.data));
    if (badReport) return badRequest(res, `Dòng doanh thu sai tháng: ${JSON.stringify(badReport).slice(0, 200)}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Tháng mới: chốt bộ cài đặt riêng (sao chép từ tháng trước) để sửa tháng khác không ảnh hưởng tháng này
        await ensureOwnConfig(client, month);
        const { rows: [imp] } = await client.query(
            `INSERT INTO finance_imports (month, file_name, imported_by, summary, warnings)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, imported_at`,
            [month, fileName || null, importedBy || null, JSON.stringify(summary || {}), JSON.stringify(warnings || [])]
        );

        for (const table of ['finance_daily', 'finance_ticket_daily', 'finance_expense_items']) {
            await client.query(`DELETE FROM ${table} WHERE month = $1 AND facility_code = ANY($2)`, [month, facilities]);
        }

        await client.query(
            `INSERT INTO finance_daily (month, date, facility_code, ticket_count, guest_count, ticket_revenue, expense, card_amount, addons, import_id)
             SELECT $1, x.date::date, x.facility_code, x.ticket_count, x.guest_count, x.ticket_revenue, x.expense, x.card_amount,
                    COALESCE(x.addons, '{}'::jsonb), $3
             FROM jsonb_to_recordset($2::jsonb) AS x(date text, facility_code text, ticket_count int, guest_count int,
                  ticket_revenue numeric, expense numeric, card_amount numeric, addons jsonb)`,
            [month, JSON.stringify(daily), imp.id]
        );
        await client.query(
            `INSERT INTO finance_ticket_daily (month, date, facility_code, ticket_type, promo_code, km, km_kind,
                                               ticket_count, guest_count, revenue, free_count, import_id)
             SELECT $1, x.date::date, x.facility_code, COALESCE(x.ticket_type, ''), COALESCE(x.promo_code, ''), COALESCE(x.km, ''),
                    COALESCE(x.km_kind, ''), x.ticket_count, x.guest_count, x.revenue, x.free_count, $3
             FROM jsonb_to_recordset($2::jsonb) AS x(date text, facility_code text, ticket_type text, promo_code text, km text,
                  km_kind text, ticket_count int, guest_count int, revenue numeric, free_count int)`,
            [month, JSON.stringify(tickets), imp.id]
        );
        await client.query(
            `INSERT INTO finance_expense_items (month, date, facility_code, description, amount, category, import_id)
             SELECT $1, x.date::date, x.facility_code, x.description, x.amount, x.category, $3
             FROM jsonb_to_recordset($2::jsonb) AS x(date text, facility_code text, description text, amount numeric, category text)`,
            [month, JSON.stringify(expenses), imp.id]
        );

        // Giữ bảng doanh thu cũ (Heatmap, Nhật ký doanh thu, Cố vấn AI) đồng bộ với file tổng.
        // Không đụng created_by/timestamp/edit_history của bản ghi đã có — giống POST /api/reports.
        for (const r of reports) {
            await client.query(
                `INSERT INTO daily_financial_reports (id, date, total_revenue, data, created_by, timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (date) DO UPDATE
                 SET total_revenue = EXCLUDED.total_revenue, data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP`,
                [r.id, r.date, r.totalRevenue, JSON.stringify(r.data), r.createdBy, r.timestamp]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, data: { importId: imp.id, importedAt: imp.imported_at } });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Lỗi POST /api/finance/import:', e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        client.release();
    }
});

module.exports = router;
