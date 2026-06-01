import { Pool } from 'pg';

const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'];

export interface RequestUser {
  id: string;
  role: string;
  facility_id: string | null;
  department_code?: string;
}

/**
 * Hàm Wrapper an toàn để chạy Query với AbortSignal (Chống Zombie Promises)
 */
const queryWithTimeout = (pool: Pool, queryText: string, queryParams: any[], abortSignal: AbortSignal) => {
  return new Promise((resolve, reject) => {
    const abortHandler = () => reject(new Error('408_TIMEOUT_OR_ABORTED: Luồng DB bị ngắt.'));
    
    if (abortSignal.aborted) return abortHandler();
    abortSignal.addEventListener('abort', abortHandler);

    pool.query(queryText, queryParams)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        // Bắt buộc dọn rác Listener bất kể thành công hay thất bại
        abortSignal.removeEventListener('abort', abortHandler);
      });
  });
};

export const executeAITool = async (
  pool: Pool,
  toolName: string, 
  aiArgs: any, 
  user: RequestUser,
  abortSignal: AbortSignal
): Promise<any> => {
  console.log(`[TOOL GATEWAY] AI Executing: '${toolName}'`, aiArgs);

  try {
    switch (toolName) {
      case 'get_user_assigned_tasks':
        return await executeGetUserAssignedTasks(pool, aiArgs, user, abortSignal);
      case 'get_facility_kpi_summary':
        return await executeGetFacilityKPISummary(pool, aiArgs, user, abortSignal);
      case 'get_daily_financial_report':
        return await executeGetDailyFinancialReport(pool, aiArgs, user, abortSignal);
      default:
        return { success: false, data: null, error: `TOOL_NOT_FOUND: Hàm ${toolName} không tồn tại.` };
    }
  } catch (error: any) {
    console.error(`[TOOL CRASH ${toolName}]`, error.message);
    // Bắt lỗi ngầm, trả JSON Error cho LLM xử lý
    return { success: false, data: null, error: error.message || 'Lỗi truy xuất hệ thống.' };
  }
};

// 1. TOOL: get_user_assigned_tasks
const executeGetUserAssignedTasks = async (pool: Pool, aiArgs: any, user: RequestUser, abortSignal: AbortSignal) => {
  // HARD-CODE RBAC: Chỉ lấy task của user hiện tại, không quan tâm AI truyền ID gì.
  const query = `
    SELECT id, title, status, urgency, TO_CHAR(deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline 
    FROM tasks 
    WHERE pic_id = $1 AND ($2::text IS NULL OR status::text = $2::text)
    ORDER BY urgency DESC, deadline ASC 
    LIMIT 20
  `;
  const params = [user.id, aiArgs.status_filter || null];
  
  const result: any = await queryWithTimeout(pool, query, params, abortSignal);
  return { success: true, data: result.rows, error: null };
};

// 2. TOOL: get_facility_kpi_summary
const executeGetFacilityKPISummary = async (pool: Pool, aiArgs: any, user: RequestUser, abortSignal: AbortSignal) => {
  const isLocalManager = ['FACILITY_MANAGER', 'DEPARTMENT_HEAD'].includes(user.role) && user.role !== 'FINANCE_DEPT';
  let targetFacility = aiArgs.target_facility_id;

  // HARD-CODE RBAC: Giam lỏng dữ liệu của Manager cục bộ
  if (isLocalManager) {
    targetFacility = user.facility_id;
  } else if (!targetFacility && user.facility_id) {
    targetFacility = user.facility_id;
  }

  const query = `
    SELECT status, COUNT(id) as total_tasks 
    FROM tasks 
    WHERE facility_id = $1 
    GROUP BY status
  `;
  const params = [targetFacility];

  if (!targetFacility) {
    return { success: false, data: null, error: "VALIDATION_ERROR: Thiếu ID Cơ sở để thống kê KPI." };
  }

  const result: any = await queryWithTimeout(pool, query, params, abortSignal);
  return { success: true, data: result.rows, error: null };
};

// 3. TOOL: get_daily_financial_report
const executeGetDailyFinancialReport = async (pool: Pool, aiArgs: any, user: RequestUser, abortSignal: AbortSignal) => {
  // HARD-CODE RBAC: Cực kỳ gắt gao. Bức tường chống Ảo Giác
  if (!['VICE_PRESIDENT', 'FINANCE_DEPT', 'SUPER_ADMIN'].includes(user.role)) {
    return { success: false, data: null, error: "403_FORBIDDEN: Chỉ dành cho Ban Giám Đốc/Tài Chính." };
  }

  // Lấy ngày do AI truyền, nếu không có thì tự động ép ngày hôm nay (Theo múi giờ VN)
  const queryDate = aiArgs.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  let query = `SELECT date, total_revenue, data FROM daily_financial_reports WHERE date = $1`;
  let params: any[] = [queryDate];

  // Nếu AI cố ý hoặc Sếp yêu cầu xem 1 cơ sở, filter trong JSONB data
  if (aiArgs.target_facility_id) {
    query += ` AND data->>'facility_id' = $2`;
    params.push(String(aiArgs.target_facility_id));
  }

  const result: any = await queryWithTimeout(pool, query, params, abortSignal);
  
  if (result.rows.length === 0) {
    return { success: true, data: { message: `Không có dữ liệu doanh thu cho ngày ${aiArgs.date}` }, error: null };
  }

  return { success: true, data: result.rows, error: null };
};
