const fs = require('fs');
const path = require('path');
const controllerPath = path.join('backend', 'src', 'controllers', 'taskController.js');
let code = fs.readFileSync(controllerPath, 'utf8');

if (!code.includes('const pool = require')) {
  code = "const pool = require('../config/db');\n" + code;
}

const newHandlers = `
const updateTaskStatusHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, evidence } = req.body;
    const updateQuery = 'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
    const { rows } = await pool.query(updateQuery, [status, id]);
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
    await pool.query('DELETE FROM task_comments WHERE task_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy công việc.' });
    res.json({ success: true, message: 'Đã xóa công việc vĩnh viễn.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Lỗi server khi xóa công việc.' });
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
    
    const updateQuery = "UPDATE tasks SET status = 'todo', deadline = $1, completed_at = NULL, updated_at = NOW() WHERE id = $2 RETURNING id, title, status, deadline";
    const { rows: updatedRows } = await pool.query(updateQuery, [deadline, taskId]);
    
    await pool.query('INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES ($1, $2, $3, NOW())', [taskId, req.user.id, \`🔄 [HỆ THỐNG]: Công việc được KHÔI PHỤC về trạng thái TODO với Deadline gia hạn tới: \${deadline}\`]);
    res.json({ success: true, data: updatedRows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ khi khôi phục công việc.' });
  }
};

const getTaskCommentsHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(\`
      SELECT c.*, u.full_name as user_name, r.name as user_role 
      FROM task_comments c 
      LEFT JOIN users u ON c.user_id = u.id 
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE c.task_id = $1 
      ORDER BY c.created_at ASC
    \`, [id]);
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
      const fullComment = await pool.query(\`
        SELECT c.*, u.full_name as user_name, r.name as user_role 
        FROM task_comments c 
        LEFT JOIN users u ON c.user_id = u.id 
        LEFT JOIN roles r ON u.role_id = r.id 
        WHERE c.id = $1
      \`, [newCommentId]);
      return res.json({ success: true, data: fullComment.rows[0] });
    } else {
      return res.status(500).json({ success: false, error: 'Không thể tạo bình luận' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi tạo bình luận.' });
  }
};
`;

code = code.replace(/module\.exports = \{.*?\};/s, newHandlers + '\nmodule.exports = { getTasksHandler, getTasksHistoryHandler, createTaskHandler, updateTaskStatusHandler, deleteTaskHandler, updateTaskSupportHandler, restoreTaskHandler, getTaskCommentsHandler, addTaskCommentHandler };');

fs.writeFileSync(controllerPath, code, 'utf8');
console.log('taskController.js updated');

const routesPath = path.join('backend', 'src', 'routes', 'taskRoutes.js');
let routesCode = fs.readFileSync(routesPath, 'utf8');

const newRoutes = `
router.put('/:id/status', authGuard, rbacGuard, taskController.updateTaskStatusHandler);
router.delete('/:id', authGuard, rbacGuard, taskController.deleteTaskHandler);
router.put('/:id/support', authGuard, rbacGuard, taskController.updateTaskSupportHandler);
router.patch('/:id/restore', authGuard, rbacGuard, taskController.restoreTaskHandler);
router.get('/:id/comments', authGuard, rbacGuard, taskController.getTaskCommentsHandler);
router.post('/:id/comments', authGuard, rbacGuard, taskController.addTaskCommentHandler);
`;

routesCode = routesCode.replace('module.exports = router;', newRoutes + '\nmodule.exports = router;');
fs.writeFileSync(routesPath, routesCode, 'utf8');
console.log('taskRoutes.js updated');
