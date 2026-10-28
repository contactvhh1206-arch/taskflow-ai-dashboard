const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');
const requireRoles = require('../middlewares/requireRoles');

// Chỉ kế toán nhập/sửa doanh thu; SUPER_ADMIN giữ quyền can thiệp.
const REPORT_WRITE_ROLES = ['FINANCE_DEPT', 'SUPER_ADMIN'];

router.get('/', authGuard, async (req, res) => {
    try {
        // Attempt to fetch from daily_financial_reports, fallback to empty array if table doesn't exist
        // LIMIT 1000: các component phía client (RevenueOverviewDashboard, HeatmapKPI, RevenueLog,
        // DailyRevenueReport) tự lọc theo tháng/ngày trên toàn bộ mảng trả về. Trần quá thấp sẽ khiến
        // dữ liệu cũ âm thầm biến mất khỏi dashboard mà không báo lỗi. Khi dữ liệu chạm mức này,
        // cần chuyển sang lọc theo khoảng ngày ở SQL + phân trang cho RevenueLog.
        const { rows } = await pool.query('SELECT * FROM daily_financial_reports ORDER BY created_at DESC LIMIT 1000');
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: true, data: [] });
    }
});

router.post('/', authGuard, requireRoles(...REPORT_WRITE_ROLES), async (req, res) => {
    try {
        const payload = req.body;
        const items = Array.isArray(payload) ? payload : [payload];
        const results = [];

        // $7 = lịch sử sửa (lý do, người sửa, tổng cũ/mới) từ Nhật ký doanh thu.
        // Không gửi (vd. Trích xuất bằng AI, Báo cáo hằng ngày) thì giữ nguyên lịch sử đang có.
        // Cần migration 006_add_edit_history_to_daily_financial_reports.sql.
        const query = `
            INSERT INTO daily_financial_reports (id, date, total_revenue, data, created_by, timestamp, edit_history)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '[]'::jsonb))
            ON CONFLICT (date) DO UPDATE
            SET total_revenue = EXCLUDED.total_revenue,
                data = EXCLUDED.data,
                edit_history = COALESCE($7::jsonb, daily_financial_reports.edit_history),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        for (const item of items) {
            const { rows } = await pool.query(query, [
                item.id,
                item.date,
                item.totalRevenue,
                JSON.stringify(item.data),
                item.createdBy,
                item.timestamp,
                Array.isArray(item.editHistory) ? JSON.stringify(item.editHistory) : null
            ]);
            if (rows.length > 0) {
                results.push(rows[0]);
            }
        }

        res.json({ success: true, data: Array.isArray(payload) ? results : results[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
