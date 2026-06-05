const taskService = require('../services/taskService');

const getTasksHandler = async (req, res) => {
    try {
        // Thu thập tham số đầu vào. Mọi lỗ hổng phân quyền facility_id ĐÃ BỊ GUARD CHẶN TỪ TRƯỚC.
        const facilityId = req.query.facility_id || null;
        const departmentCode = req.user.department_code || null;
        const status = req.query.status || null;
        
        // Toán học phân trang
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const offset = (page - 1) * limit;

        // Bắn xuống Service xử lý SQL độc lập
        const { totalRecords, rows } = await taskService.getTasksList({
            userId: req.user.id,
            role: req.user.role,
            facilityId,
            departmentCode,
            status,
            limit,
            offset
        });

        // Trả về JSON sạch sẽ, chuẩn API Meta Data
        return res.status(200).json({
            success: true,
            data: rows,
            meta: {
                total: totalRecords,
                page: page,
                limit: limit,
                total_pages: Math.ceil(totalRecords / limit)
            }
        });

    } catch (error) {
        console.error('[Controller Error - getTasksHandler]:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi hệ thống khi truy xuất danh sách công việc.'
        });
    }
};

const getTasksHistoryHandler = async (req, res) => {
    try {
        const facilityId = req.query.facility_id || null;
        const departmentCode = req.user.department_code || null;
        const picId = req.query.pic_id || null;
        const dateFrom = req.query.date_from || null;
        const dateTo = req.query.date_to || null;
        
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const offset = (page - 1) * limit;

        const { totalRecords, rows } = await taskService.getTasksHistory({
            userId: req.user.id,
            role: req.user.role,
            facilityId,
            departmentCode,
            picId,
            dateFrom,
            dateTo,
            limit,
            offset
        });

        return res.status(200).json({
            success: true,
            data: rows,
            pagination: {
                total_records: totalRecords,
                total_pages: Math.ceil(totalRecords / limit),
                current_page: page,
                limit: limit
            }
        });

    } catch (error) {
        console.error('[Controller Error - getTasksHistoryHandler]:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi hệ thống khi truy xuất lịch sử công việc.'
        });
    }
};

module.exports = { getTasksHandler, getTasksHistoryHandler };
