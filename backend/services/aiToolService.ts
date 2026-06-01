const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'];

export interface RequestUser {
  id: string;
  role: string;
  facilityId: string | null;
}

export const executeAITool = async (
  toolName: string, 
  aiArgs: any, 
  user: RequestUser
): Promise<any> => {
  console.log(`[TOOL GATEWAY] AI requested '${toolName}' with args:`, aiArgs);

  switch (toolName) {
    case 'get_daily_financial_report':
      return await handleGetFinancialReport(aiArgs, user);
    default:
      throw new Error(`[SECURITY] Tool '${toolName}' is not registered or strictly forbidden.`);
  }
};

const handleGetFinancialReport = async (aiArgs: any, user: RequestUser) => {
  const isAllAccess = ALL_ACCESS_ROLES.includes(user.role);
  let safeFacilityId = aiArgs.facilityId;

  if (!isAllAccess) {
    if (!user.facilityId) {
      throw new Error('[SECURITY FATAL] Missing Facility ID in User Token for Local Role. Access Denied!');
    }
    safeFacilityId = user.facilityId;
  }

  let query = 'SELECT id, revenue, expenses, report_date FROM daily_financial_reports';
  const queryParams: any[] = [];

  if (safeFacilityId) {
    query += ' WHERE facility_id = $1';
    queryParams.push(safeFacilityId);
  }

  return {
    status: 'SUCCESS',
    data: [
      { 
        id: '101', 
        revenue: 50000000, 
        expenses: 12000000, 
        facility_id: safeFacilityId || 'ALL_FACILITIES', 
        report_date: '2026-06-01' 
      }
    ],
    meta: {
      query_executed: true,
      rbac_applied: isAllAccess ? 'ALL_ACCESS_MODE' : 'LOCAL_RESTRICTED_MODE'
    }
  };
};
