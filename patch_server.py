import re

with open('backend/server.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

def replace_endpoint(content, method, path, new_code):
    pattern = rf"app\.{method}\('{path}'.*?\n(?=app\.(get|post|put|patch|delete))"
    # Or just find the start and end manually
    start_str = f"app.{method}('{path}'"
    start_idx = content.find(start_str)
    if start_idx == -1:
        return content
    
    # find the next app.
    end_idx = content.find('\napp.', start_idx + 10)
    if end_idx == -1: end_idx = len(content)
    
    return content[:start_idx] + new_code + '\n' + content[end_idx:]

api_restore = """app.patch('/api/tasks/:id/restore', authenticateUser, async (req, res) => {
    try {
        const taskId = req.params.id;
        const { deadline } = req.body;
        
        if (!deadline) {
            return res.status(400).json({ success: false, error: 'Bắt buộc phải có Deadline mới để khôi phục công việc.' });
        }

        const checkQuery = `SELECT facility_id, status, pic_id FROM tasks WHERE id = $1`;
        const { rows: checkRows } = await pool.query(checkQuery, [taskId]);
        
        if (checkRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy công việc.' });
        }
        const task = checkRows[0];
        if (task.status !== 'done') {
            return res.status(400).json({ success: false, error: 'Chỉ có thể khôi phục công việc đã nằm trong kho (done).' });
        }

        const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'];
        const isGlobalInteraction = ALL_ACCESS_ROLES.includes(req.user.role) || (req.user.role === 'DEPARTMENT_HEAD' && req.user.department_code === 'MARKETING');

        if (!isGlobalInteraction) {
            if (String(task.pic_id) !== String(req.user.id)) {
                return res.status(403).json({ success: false, error: '403 Forbidden: Bạn chỉ có quyền khôi phục công việc được giao cho chính mình.' });
            }
        }

        const updateQuery = `
            UPDATE tasks 
            SET status = 'todo', 
                deadline = $1,
                completed_at = NULL,
                updated_at = NOW()
            WHERE id = $2 
            RETURNING id, title, status, deadline
        `;
        const { rows: updatedRows } = await pool.query(updateQuery, [deadline, taskId]);

        await pool.query(
            `INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES ($1, $2, $3, NOW())`,
            [taskId, req.user.id, `🔄 [HỆ THỐNG]: Công việc được KHÔI PHỤC về trạng thái TODO với Deadline gia hạn tới: ${deadline}`]
        );

        res.json({ success: true, data: updatedRows[0] });
    } catch (err) {
        console.error('[CRITICAL DB ERROR /api/tasks/restore]:', err.message);
        res.status(500).json({ success: false, error: 'Lỗi máy chủ khi khôi phục công việc.' });
    }
});"""

api_status = """app.put('/api/tasks/:id/status', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, evidence } = req.body;

    const taskCheck = await pool.query('SELECT facility_id, department_code, pic_id FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy công việc.' });
    const task = taskCheck.rows[0];

    const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'];
    const isGlobalInteraction = ALL_ACCESS_ROLES.includes(req.user.role) || (req.user.role === 'DEPARTMENT_HEAD' && req.user.department_code === 'MARKETING');

    if (!isGlobalInteraction) {
        if (String(task.pic_id) !== String(req.user.id)) {
            return res.status(403).json({ error: '403 Forbidden: Bạn chỉ có quyền tương tác với công việc được giao cho chính mình.' });
        }
    }

    const updateQuery = `
      UPDATE tasks 
      SET status = $1, 
          evidence = COALESCE($2, evidence), 
          updated_at = NOW(),
          completed_at = CASE WHEN $1 = 'done' THEN NOW() ELSE completed_at END
      WHERE id = $3 
      RETURNING *
    `;
    const { rows } = await pool.query(updateQuery, [status, evidence || null, id]);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Lỗi cập nhật trạng thái:", error);
    res.status(500).json({ error: 'Lỗi server khi cập nhật trạng thái.' });
  }
});"""

api_support = """app.put('/api/tasks/:id/support', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const taskCheck = await pool.query('SELECT facility_id, department_code, pic_id FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy công việc.' });
    const task = taskCheck.rows[0];

    const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'];
    const isGlobalInteraction = ALL_ACCESS_ROLES.includes(req.user.role) || (req.user.role === 'DEPARTMENT_HEAD' && req.user.department_code === 'MARKETING');

    if (!isGlobalInteraction) {
        if (String(task.pic_id) !== String(req.user.id)) {
            return res.status(403).json({ error: '403 Forbidden: Bạn chỉ có quyền tương tác với công việc được giao cho chính mình.' });
        }
    }

    const updateQuery = `
      UPDATE tasks 
      SET needs_support = true, 
          updated_at = NOW() 
      WHERE id = $1 
      RETURNING id, title, needs_support as "needsSupport"
    `;
    const { rows } = await pool.query(updateQuery, [id]);
    res.json({ success: true, message: 'Đã gửi yêu cầu hỗ trợ', data: rows[0] });
  } catch (error) {
    console.error("Lỗi server khi yêu cầu hỗ trợ:", error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});"""

api_comments = """app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const comment = req.body.comment || req.body.content;

    const taskCheck = await pool.query('SELECT facility_id, department_code, pic_id FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy công việc.' });
    const task = taskCheck.rows[0];

    const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT'];
    const isGlobalInteraction = ALL_ACCESS_ROLES.includes(req.user.role) || (req.user.role === 'DEPARTMENT_HEAD' && req.user.department_code === 'MARKETING');

    if (!isGlobalInteraction) {
        if (String(task.pic_id) !== String(req.user.id)) {
            return res.status(403).json({ error: '403 Forbidden: Bạn chỉ có quyền tương tác với công việc được giao cho chính mình.' });
        }
    }

    if (!comment) return res.status(400).json({ error: 'Nội dung bình luận trống' });

    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: '401 Unauthorized: Không thể xác định danh tính. Vui lòng đăng nhập lại!' });
    }
    const realUserId = req.user.id;

    const { rows } = await pool.query(`
      INSERT INTO task_comments (task_id, user_id, content)
      VALUES ($1, $2, $3) RETURNING *
    `, [id, realUserId, comment]);
    
    const newCommentId = (rows && rows.length > 0) ? rows[0].id : null;
    
    if (newCommentId) {
        const getCommentSql = `
           SELECT c.*, u.full_name as user_name, r.name as user_role 
           FROM task_comments c 
           LEFT JOIN users u ON c.user_id = u.id 
           LEFT JOIN roles r ON u.role_id = r.id 
           WHERE c.id = $1
        `;
        const fullComment = await pool.query(getCommentSql, [newCommentId]);
        return res.json({ success: true, data: fullComment.rows[0] });
    } else {
        return res.status(500).json({ success: false, error: 'Không thể tạo bình luận' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi tạo bình luận.' });
  }
});"""

api_tasks_post = """app.post('/api/tasks', authenticateUser, async (req, res) => {
    try {
      const { title, desc, pic_id, deadline, status, urgent, pic, facility } = req.body;
      
      // =====================================================================
      // 1. HỨNG PAYLOAD VÀ SANITIZE (DỌN RÁC CHUỖI RỖNG)
      // =====================================================================
      let insert_facility_id = req.body.facility_id || req.body.facility;
      let insert_dept_code = req.body.department_code;

      if (insert_facility_id === "" || insert_facility_id === undefined) insert_facility_id = null;
      if (insert_dept_code === "" || insert_dept_code === undefined) insert_dept_code = null;

      const GLOBAL_DEPTS = ['MARKETING', 'FINANCE', 'HQ', 'IT', 'HR', 'BGD'];

      // =====================================================================
      // 2. FORCE OVERRIDE & BẢO TOÀN QUYỀN ADMIN (PHÂN QUYỀN ZERO-TRUST)
      // =====================================================================
      if (req.user.role === 'FACILITY_MANAGER') {
          insert_facility_id = req.user.facility_id;
          insert_dept_code = null;
      } 
      else if (['DEPARTMENT_HEAD', 'FINANCE_DEPT', 'ADMIN'].includes(req.user.role)) {
          insert_facility_id = null;
          insert_dept_code = req.user.department_code;
      }
      else if (['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(req.user.role)) {
          // LÃNH ĐẠO CẤP CAO: Phân loại chuỗi để chống Crash
          if (insert_facility_id) {
              const upperFacility = String(insert_facility_id).toUpperCase();
              if (GLOBAL_DEPTS.includes(upperFacility)) {
                  insert_dept_code = upperFacility;
                  insert_facility_id = null;
              } else if (insert_facility_id !== 'ALL' && insert_facility_id !== 'HQ') {
                  let parsedFac = parseInt(insert_facility_id, 10);
                  if (!isNaN(parsedFac)) {
                      insert_facility_id = parsedFac;
                  } else {
                      const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [insert_facility_id]);
                      if (facRecord.rows.length > 0) insert_facility_id = facRecord.rows[0].id;
                      else insert_facility_id = null; 
                  }
              }
          }
          if (insert_facility_id === 'ALL' || insert_facility_id === 'HQ') insert_facility_id = null;
      }

      // =====================================================================
      // 3. KIỂM TRA CHÉO PIC BẰNG USER_ID
      // =====================================================================
      let final_pic_id = null;
      const input_pic_id = pic_id || pic;
      if (input_pic_id) { 
          // Cho phép tìm pic theo name (String) nếu pic_id truyền lên là String tên người
          let picCheck;
          if (isNaN(parseInt(input_pic_id))) {
              picCheck = await pool.query('SELECT id, facility_id, department_code FROM users WHERE full_name = $1 OR username = $1 LIMIT 1', [input_pic_id]);
          } else {
              picCheck = await pool.query('SELECT id, facility_id, department_code FROM users WHERE id = $1 LIMIT 1', [input_pic_id]);
          }
          
          if (picCheck.rows.length === 0) {
              return res.status(404).json({ success: false, error: "Lỗi: Người phụ trách (PIC) không tồn tại!" });
          }
          
          const foundPic = picCheck.rows[0];
          final_pic_id = foundPic.id;
          
          if (!['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(req.user.role)) {
              if (req.user.facility_id) {
                  if (String(foundPic.facility_id) !== String(req.user.facility_id)) {
                      return res.status(403).json({ success: false, error: "Lỗi 403: Không được phép gán việc cho nhân sự ngoài cơ sở!" });
                  }
              } 
              else if (req.user.department_code) {
                  const normalizeDept = d => d ? String(d).toUpperCase() : '';
                  if (normalizeDept(foundPic.department_code) !== normalizeDept(req.user.department_code)) {
                      return res.status(403).json({ success: false, error: "Lỗi 403: Không được phép gán việc cho nhân sự ngoài phòng ban!" });
                  }
              }
          }
      }

      let priorityStars = 0;
      if (req.user.role === 'SUPER_ADMIN') priorityStars = 3;
      else if (req.user.role === 'VICE_PRESIDENT') priorityStars = 2;

      const insertQuery = `
        INSERT INTO tasks (title, description, status, urgency, deadline, pic_id, facility_id, department_code, priority_level, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING id, title, description as desc, status, urgency as urgent, TO_CHAR(deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, created_at as "createdAt"
      `;
      const { rows } = await pool.query(insertQuery, [
        title, 
        desc || '', 
        status || 'todo', 
        urgent || false, 
        deadline, 
        final_pic_id, 
        insert_facility_id,
        insert_dept_code,
        priorityStars,
        req.user.id
      ]);

      const newTask = {
        ...rows[0],
        pic: pic || 'Chưa gán',
        picId: pic || 'unassigned',
        facility: facility || 'HQ',
        facilityId: facility || 'HQ'
      };

      res.json({ success: true, data: newTask });
    } catch (error) {
      console.error("Lỗi chi tiết từ DB:", error.message, error.stack);
      res.status(500).json({ error: 'Lỗi server khi lưu công việc.' });
    }
});"""

content = replace_endpoint(content, 'patch', '/api/tasks/:id/restore', api_restore)
content = replace_endpoint(content, 'put', '/api/tasks/:id/status', api_status)
content = replace_endpoint(content, 'put', '/api/tasks/:id/support', api_support)
content = replace_endpoint(content, 'post', '/api/tasks/:id/comments', api_comments)
content = replace_endpoint(content, 'post', '/api/tasks', api_tasks_post)

with open('backend/server.js', 'w', encoding='utf-8') as f:
    f.write(content)
