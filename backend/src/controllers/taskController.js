const taskService = require('../services/taskService');
const pool = require('../config/database');

const getTasksHandler = async (req, res) => {
    try {
        // Thu thập tham số đầu vào. Mọi lỗ hổng phân quyền facility_id ĐÃ BỊ GUARD CHẶN TỪ TRƯỚC.
        let facilityId = req.query.facility_id || null;
        let departmentCode = req.user.department_code || null;
        const status = req.query.status || null;
        
        if (req.user.role === 'FACILITY_MANAGER') {
            facilityId = req.user.facility_id || facilityId;
            departmentCode = null;
        }
        
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
        console.log("DEBUG getTasksHandler rows:", rows.length, rows);
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
        let facilityId = req.query.facility_id || null;
        let departmentCode = req.user.department_code || null;
        const picId = req.query.pic_id || null;
        const dateFrom = req.query.date_from || null;
        const dateTo = req.query.date_to || null;

        if (req.user.role === 'FACILITY_MANAGER') {
            facilityId = req.user.facility_id || facilityId;
            departmentCode = null;
        }
        
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
        const { title, desc, pic_id, picId, pic, deadline, status, urgent, facility, facilityId, department_code, facility_id } = req.body;
        
        // --- VALIDATION: CHẶN DEADLINE QUÁ KHỨ ---
        if (deadline) {
          const deadlineDate = new Date(deadline);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (deadlineDate < today) {
            return res.status(400).json({
              success: false,
              error: 'Deadline không được nằm trong quá khứ.'
            });
          }
        }
        
        // --- 1. ÉP KIỂU STRICT (INT4) & CHUẨN HOÁ DỮ LIỆU ---
        let rawFacility = facility_id || facilityId || facility;
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
        const isAllAccess = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(userRole);

        if (userRole === 'FACILITY_MANAGER') {
            insert_facility_id = parseInt(req.user.facility_id, 10);
            if (isNaN(insert_facility_id)) {
                return res.status(403).json({ success: false, error: 'Lỗi Zero-Trust: Không xác định được ID Cơ sở của Quản lý.' });
            }
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

        const input_pic_id = pic_id || picId || pic;
        let final_pic_id = null;

        if (input_pic_id) { 
            // Lọc sạch rác từ Frontend, chỉ giữ lại tên/email gốc (VD: "dbace (QL)" -> "dbace")
            const clean_pic_input = String(input_pic_id).replace(/\s*\(.*?\)\s*/g, '').trim();
            
            const foundPic = await taskService.getUserDetails(clean_pic_input);
            // TRẢ LẠI CỜ 404 BẢO MẬT: Không tìm thấy người thì ném lỗi, không được gán null mù quáng!
            if (!foundPic) {
                return res.status(404).json({ success: false, error: "Lỗi: Người phụ trách (PIC) không tồn tại hoặc dữ liệu sai lệch!" });
            }
            final_pic_id = foundPic.id;
            
            if (isAllAccess && insert_facility_id === null && foundPic.facility_id) {
                insert_facility_id = parseInt(foundPic.facility_id, 10);
            }
            
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

        // Fetch fully hydrated task to send back to frontend
        const { rows } = await pool.query(`
            SELECT pt.id, pt.title, pt.description as desc, pt.status, pt.urgency as urgent, 
                   TO_CHAR(pt.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
                   pt.created_at as "createdAt", pt.updated_at as "completedAt",
                   pt.needs_support as "needsSupport",
                   CASE WHEN pt.priority_level = 'CRITICAL' THEN 5 WHEN pt.priority_level = 'HIGH' THEN 3 WHEN pt.priority_level = '5' OR pt.priority_level = '3' THEN 5 WHEN pt.priority_level = '2' THEN 3 ELSE 0 END as priority_stars,
                   u.full_name as pic, u.email as "picId", pt.pic_id,
                   pt.created_by as "createdBy", pt.created_by_role as "creator_role",
                   f.name as facility, f.code as "facilityId",
                   pt.facility_id as "facilityRawId",
                   pt.department_code as "department_tag",
                   pt.evidence_url as evidence,
                   0 as comment_count
            FROM tasks pt
            LEFT JOIN users u ON pt.pic_id = u.id
            LEFT JOIN facilities f ON pt.facility_id = f.id
            WHERE pt.id = $1
        `, [newTaskRow.id]);

        res.status(201).json({ success: true, data: rows[0] });

    } catch (error) {
        console.error("[Controller Error - createTaskHandler]:", error.message);
        res.status(500).json({ success: false, error: 'Đã xảy ra lỗi máy chủ trong quá trình lưu công việc. Vui lòng thử lại.' });
    }
};

const updateTaskStatusHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, evidence } = req.body;
    const updateQuery = evidence
      ? 'UPDATE tasks SET status = $1, evidence_url = $2, updated_at = NOW() WHERE id = $3 RETURNING *'
      : 'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
    const params = evidence ? [status, evidence, id] : [status, id];
    const { rows } = await pool.query(updateQuery, params);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi cập nhật trạng thái.' });
  }
};

const deleteTaskHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.user || req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Chỉ SUPER_ADMIN mới có quyền xóa vĩnh viễn công việc.' });
    }

    // 1. Lấy snapshot task đầy đủ (kèm tên cơ sở, tên PIC) trước khi xóa
    const { rows: taskRows } = await pool.query(`
      SELECT t.*, u.full_name as pic_name, f.name as facility_name
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id
      WHERE t.id = $1
    `, [id]);
    if (taskRows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy công việc.' });

    // 2. Ghi audit log (lưu toàn bộ snapshot trước khi xóa)
    await pool.query(
      'INSERT INTO task_audit_logs (task_id, action, deleted_by, deleted_by_role, task_snapshot) VALUES ($1, $2, $3, $4, $5)',
      [id, 'DELETED', req.user.id, req.user.role, JSON.stringify(taskRows[0])]
    );

    // 3. Xóa dữ liệu con (đảm bảo không vi phạm FK)
    await pool.query('DELETE FROM task_comments WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM task_operations WHERE task_id = $1', [id]);

    // 4. Xóa cứng task
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy công việc.' });

    res.json({ success: true, message: 'Đã xóa công việc vĩnh viễn.' });
  } catch (error) {
    console.error('[Controller Error - deleteTaskHandler]:', error.message);
    res.status(500).json({ success: false, error: 'Lỗi server khi xóa công việc.' });
  }
};

const getDeletedTasksHandler = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Chỉ SUPER_ADMIN mới có quyền xem lịch sử xóa.' });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;

    const countRes = await pool.query('SELECT COUNT(*) as total FROM task_audit_logs');
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    const { rows } = await pool.query(`
      SELECT
        al.id,
        al.task_id,
        al.action,
        al.deleted_by_role,
        al.task_snapshot,
        al.created_at as deleted_at,
        u.full_name as deleted_by_name
      FROM task_audit_logs al
      LEFT JOIN users u ON al.deleted_by = u.id
      ORDER BY al.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return res.status(200).json({
      success: true,
      data: rows,
      meta: {
        total: totalRecords,
        page,
        limit,
        total_pages: Math.ceil(totalRecords / limit)
      }
    });
  } catch (error) {
    console.error('[Controller Error - getDeletedTasksHandler]:', error.message);
    res.status(500).json({ success: false, error: 'Lỗi server khi tải lịch sử xóa.' });
  }
};

const updateTaskSupportHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const updateQuery = 'UPDATE tasks SET needs_support = true, updated_at = NOW() WHERE id = $1 RETURNING id, title, needs_support as "needsSupport"';
    const { rows } = await pool.query(updateQuery, [id]);
    res.json({ success: true, message: 'Đã gửi yêu cầu hỗ trợ', data: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
};

const restoreTaskHandler = async (req, res) => {
  try {
    const taskId = req.params.id;
    const { deadline } = req.body;
    if (!deadline) return res.status(400).json({ success: false, error: 'Bắt buộc phải có Deadline mới để khôi phục công việc.' });
    
    // Chặn khôi phục với deadline quá khứ
    const restoreDeadline = new Date(deadline);
    const todayRestore = new Date();
    todayRestore.setHours(0, 0, 0, 0);
    if (restoreDeadline < todayRestore) {
      return res.status(400).json({ success: false, error: 'Deadline gia hạn không được nằm trong quá khứ.' });
    }
    
    const updateQuery = "UPDATE tasks SET status = 'todo', deadline = $1, completed_at = NULL, updated_at = NOW() WHERE id = $2 RETURNING id, title, status, deadline";
    const { rows: updatedRows } = await pool.query(updateQuery, [deadline, taskId]);
    
    await pool.query('INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES ($1, $2, $3, NOW())', [taskId, req.user.id, `🔄 [HỆ THỐNG]: Công việc được KHÔI PHỤC về trạng thái TODO với Deadline gia hạn tới: ${deadline}`]);
    res.json({ success: true, data: updatedRows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ khi khôi phục công việc.' });
  }
};

const getTaskCommentsHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT c.*, u.full_name as user_name, r.name as user_role 
      FROM task_comments c 
      LEFT JOIN users u ON c.user_id = u.id 
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE c.task_id = $1 
      ORDER BY c.created_at ASC
    `, [id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Lỗi tải bình luận: ' + err.message });
  }
};

const addTaskCommentHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const comment = req.body.comment || req.body.content;
    if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });
    
    const realUserId = req.user.id;
    const { rows } = await pool.query('INSERT INTO task_comments (task_id, user_id, content) VALUES ($1, $2, $3) RETURNING *', [id, realUserId, comment]);
    const newCommentId = rows[0]?.id;
    
    if (newCommentId) {
      const fullComment = await pool.query(`
        SELECT c.*, u.full_name as user_name, r.name as user_role 
        FROM task_comments c 
        LEFT JOIN users u ON c.user_id = u.id 
        LEFT JOIN roles r ON u.role_id = r.id 
        WHERE c.id = $1
      `, [newCommentId]);
      return res.json({ success: true, data: fullComment.rows[0] });
    } else {
      return res.status(500).json({ success: false, error: 'Không thể tạo bình luận' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi tạo bình luận.' });
  }
};

const updateTaskExtensionHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập nguyên nhân xin gia hạn.' });
    }

    // Cập nhật cờ xin gia hạn và lý do
    const updateQuery = `
      UPDATE tasks
      SET extension_requested = true,
          extension_reason = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING id, title, extension_requested as "extensionRequested", extension_reason as "extensionReason"
    `;
    const { rows } = await pool.query(updateQuery, [reason.trim(), id]);

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy task.' });
    }

    // Ghi nhật ký comment hệ thống để có audit trail
    try {
      await pool.query(
        'INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES ($1, $2, $3, NOW())',
        [id, req.user.id, `⏳ [XIN GIA HẠN]: ${reason.trim()}`]
      );
    } catch (commentErr) {
      console.warn('[Extension] Ghi comment thất bại (không nghiêm trọng):', commentErr.message);
    }

    res.json({ success: true, message: 'Đã gửi yêu cầu gia hạn thành công', data: rows[0] });
  } catch (error) {
    console.error('[Controller Error - updateTaskExtensionHandler]:', error.message);
    res.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ' });
  }
};

const resolveTaskExtensionHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, newDeadline } = req.body; // action: 'approve' | 'reject'

    // Chỉ SUPER_ADMIN và VICE_PRESIDENT mới được gọi API này
    if (!['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này.' });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Hành động không hợp lệ. Phải là approve hoặc reject.' });
    }
    if (action === 'approve' && !newDeadline) {
      return res.status(400).json({ success: false, error: 'Vui lòng chọn deadline mới khi duyệt gia hạn.' });
    }

    let updateQuery, queryParams;
    if (action === 'approve') {
      updateQuery = `
        UPDATE tasks
        SET extension_requested = false,
            extension_reason = NULL,
            deadline = $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, title, deadline, extension_requested as "extensionRequested", extension_reason as "extensionReason"
      `;
      queryParams = [newDeadline, id];
    } else {
      updateQuery = `
        UPDATE tasks
        SET extension_requested = false,
            extension_reason = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, deadline, extension_requested as "extensionRequested", extension_reason as "extensionReason"
      `;
      queryParams = [id];
    }

    const { rows } = await pool.query(updateQuery, queryParams);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy task.' });
    }

    // Ghi log comment hệ thống
    try {
      const logContent = action === 'approve'
        ? `✅ [ĐÃ DUYỆT GIA HẠN] Deadline mới: ${new Date(newDeadline).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} — Phê duyệt bởi ${req.user.name || req.user.username}`
        : `❌ [TỪ CHỐI GIA HẠN] — Từ chối bởi ${req.user.name || req.user.username}`;
      await pool.query(
        'INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES ($1, $2, $3, NOW())',
        [id, req.user.id, logContent]
      );
    } catch (commentErr) {
      console.warn('[ResolveExtension] Ghi comment thất bại:', commentErr.message);
    }

    const message = action === 'approve'
      ? `✅ Đã duyệt gia hạn deadline thành công`
      : `❌ Đã từ chối yêu cầu gia hạn`;
    res.json({ success: true, message, data: rows[0] });
  } catch (error) {
    console.error('[Controller Error - resolveTaskExtensionHandler]:', error.message);
    res.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ' });
  }
};

module.exports = { getTasksHandler, getTasksHistoryHandler, createTaskHandler, updateTaskStatusHandler, deleteTaskHandler, updateTaskSupportHandler, restoreTaskHandler, getTaskCommentsHandler, addTaskCommentHandler, getDeletedTasksHandler, updateTaskExtensionHandler, resolveTaskExtensionHandler };
