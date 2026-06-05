const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/status', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || '';
        const facilityId = req.headers['x-facility-id'] || 'ALL';

        // Lấy ngày hôm nay định dạng DD/MM/YYYY
        const now = new Date();
        const todayDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

        const { rows } = await pool.query(
            `SELECT org_unit, content, date FROM daily_logs WHERE entry_type = 'Attendance' AND date = $1`,
            [todayDate]
        );

        const statusMap = {};
        
        // Nếu user.role là FACILITY_MANAGER thì chỉ khởi tạo cho cơ sở đó, nếu quản lý cấp cao thì khởi tạo tất cả từ danh sách cơ sở nếu có
        // Để đơn giản, ta lặp qua những bản ghi có sẵn trong ngày hôm nay. (Nếu muốn báo đỏ các cơ sở chưa điểm danh, ta cần join bảng facilities)
        // Tuy nhiên trong yêu cầu này, ta chỉ cần xuất ra statusMap.
        
        // Khởi tạo map cho tất cả cơ sở đã có trong log
        rows.forEach(row => {
            const fac = row.org_unit;
            if (!statusMap[fac]) {
                statusMap[fac] = { facility_id: fac, ca1: 'Chưa báo cáo', ca_lo: 'Chưa báo cáo', ca2: 'Chưa báo cáo' };
            }
            try {
                const contentObj = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                const shift = contentObj?.shift || '';
                
                if (shift === 'Ca 1 (Sáng)') statusMap[fac].ca1 = 'Đã báo cáo';
                if (shift === 'Ca Lỡ (Giữa ca)') statusMap[fac].ca_lo = 'Đã báo cáo';
                if (shift === 'Ca 2 (Chiều/Tối)') statusMap[fac].ca2 = 'Đã báo cáo';
                
                // Fallback nếu chuỗi không chuẩn
                if (shift.includes('1') || shift.toLowerCase().includes('sáng')) statusMap[fac].ca1 = 'Đã báo cáo';
                if (shift.includes('Lỡ') || shift.toLowerCase().includes('giữa')) statusMap[fac].ca_lo = 'Đã báo cáo';
                if (shift.includes('2') || shift.toLowerCase().includes('chiều')) statusMap[fac].ca2 = 'Đã báo cáo';
            } catch(e) {}
        });

        // Đảm bảo facility hiện tại luôn có trong map kể cả chưa điểm danh (để hiển thị UI chưa báo cáo)
        if (role === 'FACILITY_MANAGER' && facilityId !== 'ALL' && !statusMap[facilityId]) {
            statusMap[facilityId] = { facility_id: facilityId, ca1: 'Chưa báo cáo', ca_lo: 'Chưa báo cáo', ca2: 'Chưa báo cáo' };
        }

        res.json({ success: true, data: Object.values(statusMap) });
    } catch (e) {
        console.error("Lỗi GET /api/checkin/status:", e);
        res.json({ success: false, message: e.message, data: [] });
    }
});

module.exports = router;
