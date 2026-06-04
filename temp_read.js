    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Lá»—i cáº­p nháº­t tráº¡ng thÃ¡i:", error);
    res.status(500).json({ error: 'Lá»—i server khi cáº­p nháº­t tráº¡ng thÃ¡i.' });
  }
});

app.put('/api/tasks/:id/support', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    // TÆ°á»ng lá»­a chá»‘ng IDOR
    const taskCheck = await pool.query('SELECT facility_id, department_code, pic_id FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    const task = taskCheck.rows[0];
    
    // NẾU LÀ NGƯỜI ĐƯỢC GIAO VIỆC THÌ ĐƯỢC ĐẶC CÁCH VƯỢT TƯỜNG LỬA IDOR
    if (String(task.pic_id) === String(req.user.id)) {
        task.facility_id = req.user.facility_id;
        task.department_code = req.user.department_code || req.user.department_id;
    }
    
    if (req.user.role === 'FACILITY_MANAGER' && task.facility_id !== req.user.facility_id) {
        return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a cÆ¡ sá»Ÿ khÃ¡c!' });
    }
    if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
        const userDept = normalizeDept(req.user.department_code || req.user.department_id);
        const taskDept = normalizeDept(task.department_code);
        if (taskDept && taskDept !== userDept) {
            return res.status(403).json({ error: '403 Forbidden: KhÃ´ng cÃ³ quyá»n sá»­a tháº» cÃ´ng viá»‡c cá»§a phÃ²ng ban khÃ¡c!' });
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
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    }

    res.json({ success: true, message: 'ÄÃ£ gá»­i yÃªu cáº§u há»— trá»£ Ä‘áº¿n Ban GiÃ¡m Äá»‘c', data: rows[0] });
  } catch (error) {
    console.error("Lá»—i server khi yÃªu cáº§u há»— trá»£:", error);
    res.status(500).json({ error: 'Lá»—i mÃ¡y chá»§ ná»™i bá»™' });
  }
});

// --- BƯỚC 4: ROUTE KHÔI PHỤC TASK TỪ LỊCH SỬ ---
app.patch('/api/tasks/:id/restore', authenticateUser, async (req, res) => {
    try {
        const taskId = req.params.id;
        const { deadline } = req.body;
        const userFacilityId = req.user.facility_id;
        const userRole = req.user.role;

        if (!deadline) {
            return res.status(400).json({ success: false, error: 'Bắt buộc phải có Deadline mới để khôi phục công việc.' });
        }

        const checkQuery = `SELECT facility_id, status FROM tasks WHERE id = $1`;
        const { rows: checkRows } = await pool.query(checkQuery, [taskId]);
        
        if (checkRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy công việc.' });
        }

        const task = checkRows[0];
        
        if (task.status !== 'done') {
            return res.status(400).json({ success: false, error: 'Chỉ có thể khôi phục công việc đã nằm trong kho (done).' });
        }

        const isGlobalInteraction = userRole === 'FINANCE_DEPT' || (userRole === 'DEPARTMENT_HEAD' && normalizeDept(req.user.department_code) === 'MARKETING');
        if (!['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(userRole) && !isGlobalInteraction) {
            if (userRole === 'FACILITY_MANAGER' && String(task.facility_id) !== String(userFacilityId)) {
                return res.status(403).json({ success: false, error: 'Lỗi Phân quyền: Không có quyền khôi phục công việc của cơ sở khác.' });
            }
            if (userRole === 'DEPARTMENT_HEAD') {
                const taskDept = normalizeDept(task.department_code);
                const userDept = normalizeDept(req.user.department_code || req.user.department_id);
                if (taskDept !== userDept) {
                    return res.status(403).json({ success: false, error: 'Lỗi Phân quyền: Không có quyền khôi phục công việc của phòng ban khác hoặc cơ sở.' });
                }
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
});


app.get('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
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
    console.error("[API GET Comment] Lá»—i 500:", err);
    res.status(500).json({ success: false, error: 'Lá»—i táº£i bÃ¬nh luáº­n: ' + err.message });
  }
});

app.post('/api/tasks/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const comment = req.body.comment || req.body.content;

    // TÆ°á»ng lá»­a chá»‘ng IDOR
    const taskCheck = await pool.query('SELECT facility_id, department_code, pic_id FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.' });
    const task = taskCheck.rows[0];
    
    // NẾU LÀ NGƯỜI ĐƯỢC GIAO VIỆC THÌ ĐƯỢC ĐẶC CÁCH VƯỢT TƯỜNG LỬA IDOR
    if (String(task.pic_id) === String(req.user.id)) {
        task.facility_id = req.user.facility_id;
        task.department_code = req.user.department_code || req.user.department_id;
    }
