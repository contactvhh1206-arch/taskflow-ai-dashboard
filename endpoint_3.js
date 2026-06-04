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

    if (!comment) return res.status(400).json({ error: 'Ná»™i dung bÃ¬nh luáº­n trá»‘ng' });

    // 1. LẤY USER_ID TỪ TOKEN, KHÔNG CHÂM CHƯỚC
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: '401 Unauthorized: Không thể xác định danh tính. Vui lòng đăng nhập lại!' });
    }
    const realUserId = req.user.id;

    // 2. THỰC THI INSERT (LÃºc nÃ y realUserId Ä‘Ã£ Ä‘Æ°á»£c Ä‘áº£m báº£o 100% lÃ  an toÃ n)
    const { rows } = await pool.query(`
      INSERT INTO task_comments (task_id, user_id, content)
      VALUES ($1, $2, $3) RETURNING *
    `, [id, realUserId, comment]);
    


        // 4. KHá»žI Táº O BIáº¾N TRáº¢ Vá»€ Tá»ª CÆ  Sá»ž Dá»® LIá»†U
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
        return res.status(500).json({ success: false, error: 'KhÃ´ng thá»ƒ táº¡o bÃ¬nh luáº­n' });
    }
  } catch (error) {
    if (error.code === '23503') {
        console.warn(`[API Comment] Cá»‘ gáº¯ng bÃ¬nh luáº­n vÃ o Task khÃ´ng tá»“n táº¡i: task_id=${req.params.id}`);
        return res.status(404).json({ 
            success: false, 
            message: 'Task nÃ y khÃ´ng cÃ²n tá»“n táº¡i hoáº·c Ä‘Ã£ bá»‹ xÃ³a. Vui lÃ²ng lÃ m má»›i trang.' 
        });
    }

    console.error('[API       const { title, desc, pic_id, pic, deadline, status, urgent, facility, department_code, facility_id } = req.body;
      
      let insert_facility_id = facility_id || facility;
      let insert_dept_code = department_code;

      if (insert_facility_id === "" || insert_facility_id === undefined) insert_facility_id = null;
      if (insert_dept_code === "" || insert_dept_code === undefined) insert_dept_code = null;

      const GLOBAL_DEPTS = ['MARKETING', 'FINANCE', 'HQ', 'IT', 'HR', 'BGD'];

      if (req.user.role === 'FACILITY_MANAGER') {
          insert_facility_id = req.user.facility_id;
          insert_dept_code = null;
      } 
      else if (['DEPARTMENT_HEAD', 'FINANCE_DEPT', 'ADMIN'].includes(req.user.role)) {
          insert_facility_id = null;
          insert_dept_code = req.user.department_code;
      }
      else if (['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(req.user.role)) {
          const upperFacility = insert_facility_id ? String(insert_facility_id).toUpperCase() : '';
          
          if (GLOBAL_DEPTS.includes(upperFacility)) {
              insert_dept_code = upperFacility;
              insert_facility_id = null;
          } else {
              if (insert_facility_id && insert_facility_id !== 'ALL') {
                  let parsedFac = parseInt(insert_facility_id, 10);
                  if (!isNaN(parsedFac)) {
                      insert_facility_id = parsedFac;
                  } else {
                      const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [insert_facility_id]);
                      if (facRecord.rows.length > 0) insert_facility_id = facRecord.rows[0].id;
                      else insert_facility_id = null; 
                  }
              }
              if (insert_facility_id === 'ALL' || insert_facility_id === 'HQ') insert_facility_id = null;
          }
      }
      else {
          if (req.user.facility_id) {
              insert_facility_id = req.user.facility_id;
              insert_dept_code = null;
          } else if (req.user.department_code) {
              insert_facility_id = null;
              insert_dept_code = req.user.department_code;
          } else {
              insert_facility_id = null;
              insert_dept_code = null;
          }
      }

      let priorityStars = 0;
      if (req.user.role === 'SUPER_ADMIN') priorityStars = 3;
      else if (req.user.role === 'VICE_PRESIDENT') priorityStars = 2;

      let final_pic_id = null;
      const input_pic_id = pic_id || pic;
      if (input_pic_id) { 
          const picCheck = await pool.query('SELECT id, facility_id, department_code FROM users WHERE id = $1 LIMIT 1', [input_pic_id]);
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
              } else if (req.user.department_code) {
                  if (normalizeDept(foundPic.department_code) !== normalizeDept(req.user.department_code)) {
                      return res.status(403).json({ success: false, error: "Lỗi 403: Không được phép gán việc cho nhân sự ngoài phòng ban!" });
                  }
              }
          }
      }

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
      ]);©m quyá»n!"});
                  } else {
                      pic_id = checkExist.rows[0].id;
                  }
              } else {
                  pic_id = null;
              }
          } else {
              pic_id = picUser.rows[0].id;
          }
      }

      // BỨC TƯỜNG ZERO TRUST TỐI HẬU: CẤM FALLBACK MÙ QUÁNG
      if (!insert_facility_id || insert_facility_id === 'ALL') {
          // CHỈ NHÓM TOÀN QUYỀN mới được phép mượn kho của HQ làm mặc định
          if (ALL_ACCESS_ROLES.includes(req.user.role)) {
              // CHẤP NHẬN BỎ TRỐNG CƠ SỞ ĐỐI VỚI PHÒNG BAN CHUYÊN TRÁCH ĐỂ THỂ HIỆN LÀ TASK CHUNG
              insert_facility_id = null;
          } else {
              // NHÓM LOCAL: Bắn hạ ngay lập tức! Không có facility_id thì không được phép tồn tại!
              return res.status(403).json({ 
                  success: false, 
                  error: "LỖI ZERO TRUST: Dữ liệu định danh Cơ sở bị hỏng. Vui lòng đăng nhập lại hoặc liên hệ IT!" 
              });
          }
      }

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
        pic_id, 
        insert_facility_id,
        insert_dept_code,
        priorityStars,
        req.user.id
      ]);
    
    const newTask = {
      ...rows[0],
      pic: pic || 'ChÆ°a gÃ¡n',
      picId: pic || 'unassigned',
      facility: facility || 'HQ',
      facilityId: facility || 'HQ'
    };


      res.json({ success: true, data: newTask });
  } catch (error) {
    console.error("Lá»—i chi tiáº¿t tá»« DB:", error.message, error.stack);
    res.status(500).json({ error: 'Lá»—i server khi lÆ°u cÃ´ng viá»‡c.' });
  }
});

// API ÄÄƒng nháº­p giáº£ láº­p