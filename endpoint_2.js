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