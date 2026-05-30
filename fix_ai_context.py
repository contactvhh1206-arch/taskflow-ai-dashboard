import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update getAiPermissions to return facilityCode
get_ai_permissions_pattern = re.compile(
    r"function getAiPermissions\(user\) \{.*?return \{\s*isGlobal,\s*departmentCode,\s*facilityId\s*\};\s*\}",
    re.DOTALL
)

get_ai_permissions_replacement = """function getAiPermissions(user) {
    if (!user || !user.role) {
        return { isGlobal: false, departmentCode: null, facilityId: null, facilityCode: null };
    }
    
    const role = user.role;
    const departmentCode = user.department_code || user.department_id || '';
    const facilityId = user.facility_id ? String(user.facility_id) : null;
    const facilityCode = user.facility_code ? String(user.facility_code) : null;
    
    // Quét toàn bộ mọi biến thể tiếng Việt và tiếng Anh của khối Marketing
    const isMarketing = Boolean(String(departmentCode).match(/MARKETING|TRUYỀN THÔNG|MKT|MEDIA/i));
    
    // Xác định quyền All-Access (Global)
    const isGlobal = role === 'SUPER_ADMIN' || 
                     role === 'VICE_PRESIDENT' || 
                     role === 'FINANCE_DEPT' ||
                     (role === 'DEPARTMENT_HEAD' && isMarketing);
                     
    return {
        isGlobal,
        departmentCode,
        facilityId,
        facilityCode
    };
}"""

content = get_ai_permissions_pattern.sub(get_ai_permissions_replacement, content)

# 2. Update executeGetRevenueTool to use facilityCode and throw SECURITY ALERT
execute_revenue_pattern = re.compile(
    r"async function executeGetRevenueTool\(args, user\) \{.*?const targetFacility = perms\.isGlobal \? \(facility_code \? String\(facility_code\) : null\) : perms\.facilityId;",
    re.DOTALL
)

execute_revenue_replacement = """async function executeGetRevenueTool(args, user) {
    const { date_range, facility_code } = args;
    
    // 1. Áp dụng Hàm Trung Tâm Phân Quyền
    const perms = getAiPermissions(user);
    
    // 2. Cảnh báo và Chặn Quyền Xuyên Không (Cross-facility)
    if (!perms.isGlobal && facility_code && String(facility_code).toUpperCase().trim() !== String(perms.facilityCode).toUpperCase().trim()) {
        console.warn(`[SECURITY ALERT] User ${user.id} (Facility Code ${perms.facilityCode}) cố gắng truy cập doanh thu Facility ${facility_code}`);
        return { error: `[SECURITY ALERT] Hệ thống từ chối: Tài khoản của bạn không đủ quyền tra cứu dữ liệu doanh thu của cơ sở chéo [${facility_code}].` };
    }

    const targetFacility = perms.isGlobal ? (facility_code ? String(facility_code) : null) : perms.facilityCode;"""

content = execute_revenue_pattern.sub(execute_revenue_replacement, content)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced getAiPermissions and executeGetRevenueTool successfully!")
