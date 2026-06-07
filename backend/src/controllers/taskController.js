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

const createTaskHandler = async (req, res) => {
    try {
        const { title, desc, pic_id, pic, deadline, status, urgent, facility, department_code, facility_id } = req.body;
        
        // --- 1. ÉP KIỂU STRICT (INT4) & CHUẨN HOÁ DỮ LIỆU ---
        let rawFacility = facility_id || facility;
        let insert_facility_id = parseInt(rawFacility, 10);
        if (isNaN(insert_facility_id)) {
            insert_facility_id = null;
        }

        let insert_dept_code = department_code;
        if (insert_dept_code === "" || insert_dept_code === undefined) {
            insert_dept_code = null;
        }

        // --- 2. KIỂM SOÁT RBAC (ROLE-BASED ACCESS CONTROL) KHẮT KHE ---
        const GLOBAL_DEPTS = ['MARKETING', 'FINANCE', 'HQ', 'IT', 'HR', 'BGD'];
        const userRole = req.user.role;
        
        // Biến xác định nhóm All-Access (Tuyệt đối không có ADMIN ở đây)
        const isAllAccess = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'].includes(userRole) 
                            || (userRole === 'DEPARTMENT_HEAD' && req.user.department_code === 'MARKETING');

        if (userRole === 'FACILITY_MANAGER') {
            insert_facility_id = parseInt(req.user.facility_id, 10);
            insert_dept_code = null;
        } 
        else if (['DEPARTMENT_HEAD', 'FINANCE_DEPT', 'ADMIN'].includes(userRole) && !isAllAccess) {
            insert_facility_id = null;
            insert_dept_code = req.user.department_code;
        }
        else if (isAllAccess) {
            const upperFacility = rawFacility ? String(rawFacility).toUpperCase() : '';
            if (GLOBAL_DEPTS.includes(upperFacility)) {
                insert_dept_code = upperFacility;
                insert_facility_id = null;
            } else {
                if (insert_facility_id === null && rawFacility && rawFacility !== 'ALL' && rawFacility !== 'HQ') {
                    const dbFacId = await taskService.getFacilityIdByNameOrCode(rawFacility);
                    insert_facility_id = dbFacId;
                }
            }
        }
        else {
            // Nhân viên thường (Local Staff)
            if (req.user.facility_id) {
                insert_facility_id = parseInt(req.user.facility_id, 10);
                insert_dept_code = null;
            } else if (req.user.department_code) {
                insert_facility_id = null;
                insert_dept_code = req.user.department_code;
            } else {
                insert_facility_id = null;
                insert_dept_code = null;
            }
        }

        // BỨC TƯỜNG ZERO TRUST TỐI HẬU
        if (insert_facility_id === null) {
            if (!isAllAccess && !insert_dept_code) {
                return res.status(403).json({ 
                    success: false, 
                    error: "LỖI ZERO TRUST: Dữ liệu định danh khu vực bị hỏng. Bạn không có quyền khởi tạo công việc ở cấp độ toàn cục!" 
                });
            }
        }

        // --- 3. ĐỊNH DANH ƯU TIÊN VÀ NGƯỜI NHẬN VIỆC (PIC) ---
        let priorityLevel = 'LOW';
        if (userRole === 'SUPER_ADMIN') priorityLevel = 'CRITICAL';
        else if (userRole === 'VICE_PRESIDENT') priorityLevel = 'HIGH';
        else if (userRole === 'FACILITY_MANAGER' || userRole === 'DEPARTMENT_HEAD') priorityLevel = 'MEDIUM';

        const input_pic_id = pic_id || pic;
        let final_pic_id = null;

        if (input_pic_id) { 
            const foundPic = await taskService.getUserDetails(input_pic_id);
            if (!foundPic) {
                return res.status(404).json({ success: false, error: "Lỗi: Người phụ trách (PIC) không tồn tại hoặc đã nghỉ việc!" });
            }
            
            final_pic_id = foundPic.id;
            
            if (!isAllAccess) {
                if (req.user.facility_id) {
                    if (foundPic.facility_id !== parseInt(req.user.facility_id, 10)) {
                        return res.status(403).json({ success: false, error: "Lỗi 403: Không được phép gán việc cho nhân sự ngoài cơ sở!" });
                    }
                } else if (req.user.department_code) {
                    if (String(foundPic.department_code || '').toLowerCase() !== String(req.user.department_code || '').toLowerCase()) {
                        return res.status(403).json({ success: false, error: "Lỗi 403: Không được phép gán việc cho nhân sự ngoài phòng ban!" });
                    }
                }
            }
        }

        // --- 4. CHUẨN BỊ PAYLOAD VÀ CHỌC XUỐNG SERVICE ---
        const taskPayload = {
            title: title, 
            description: desc || '', 
            status: status || 'todo', 
            urgency: urgent === true || urgent === 'true', 
            deadline: deadline, 
            pic_id: final_pic_id, 
            facility_id: insert_facility_id,
            department_code: insert_dept_code,
            priority_level: priorityLevel, 
            created_by: parseInt(req.user.id, 10),
            created_by_role: userRole 
        };

        const newTaskRow = await taskService.createNewTask(taskPayload);

        res.status(201).json({ success: true, data: newTaskRow });

    } catch (error) {
        console.error("[Controller Error - createTaskHandler]:", error.message);
        res.status(500).json({ success: false, error: 'Đã xảy ra lỗi máy chủ trong quá trình lưu công việc. Vui lòng thử lại.' });
    }
};

module.exports = { getTasksHandler, getTasksHistoryHandler, createTaskHandler };
