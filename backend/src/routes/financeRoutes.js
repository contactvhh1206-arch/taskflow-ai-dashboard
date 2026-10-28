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

router.get('/config', authGuard, requireRoles(...READ_ROLES), async (req, res) => {
    try {
        const [prices, codes] = await Promise.all([
            // kind/name cần migration 008_finance_service_types.sql
            pool.query('SELECT ticket_type, list_price, kind, name FROM finance_ticket_prices ORDER BY kind DESC, list_price NULLS LAST, ticket_type'),
            pool.query('SELECT code, name FROM finance_promo_codes ORDER BY code'),
        ]);
        res.json({ success: true, data: { prices: prices.rows, promoCodes: codes.rows } });
    } catch (e) {
        console.error('Lỗi GET /api/finance/config:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/config', authGuard, requireRoles(...WRITE_ROLES), async (req, res) => {
    const { prices, promoCodes } = req.body || {};
    if (prices !== undefined && !Array.isArray(prices)) return badRequest(res, 'prices phải là mảng');
    if (promoCodes !== undefined && !Array.isArray(promoCodes)) return badRequest(res, 'promoCodes phải là mảng');
    for (const p of prices || []) {
        const kind = p.kind || 'ticket';
        const priceOk = kind === 'service'
            ? (p.list_price === null || p.list_price === undefined || p.list_price === '' || Number(p.list_price) >= 0)
            : Number(p.list_price) >= 0 && p.list_price !== null && p.list_price !== '';
        if (!p.ticket_type || !['ticket', 'service'].includes(kind) || !priceOk) {
            return badRequest(res, `Loại vé/dịch vụ không hợp lệ: ${JSON.stringify(p)}`);
        }
    }
    for (const c of promoCodes || []) {
        if (!c.code || !c.name) return badRequest(res, `Mã KM không hợp lệ: ${JSON.stringify(c)}`);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const p of prices || []) {
            await client.query(
                `INSERT INTO finance_ticket_prices (ticket_type, list_price, kind, name, updated_at) VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (ticket_type) DO UPDATE
                 SET list_price = EXCLUDED.list_price, kind = EXCLUDED.kind, name = EXCLUDED.name, updated_at = NOW()`,
                [
                    String(p.ticket_type).trim().toUpperCase(),
                    p.list_price === null || p.list_price === undefined || p.list_price === '' ? null : Number(p.list_price),
                    p.kind || 'ticket',
                    p.name ? String(p.name).trim() : null,
                ]
            );
        }
        for (const c of promoCodes || []) {
            await client.query(
                `INSERT INTO finance_promo_codes (code, name, updated_at) VALUES ($1, $2, NOW())
                 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
                [String(c.code).trim().toUpperCase(), String(c.name).trim()]
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
