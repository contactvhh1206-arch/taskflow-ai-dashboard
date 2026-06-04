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

