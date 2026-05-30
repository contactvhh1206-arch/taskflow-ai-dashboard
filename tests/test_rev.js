const userFinance = { id: 1, role: 'DEPARTMENT_HEAD', department_code: 'FINANCE', facility_id: null };
const userAdmin = { id: 2, role: 'SUPER_ADMIN' };

function getAiPermissions(user) {
    if (!user || !user.role) {
        return { isGlobal: false, departmentCode: null, facilityId: null };
    }
    
    const role = user.role;
    const departmentCode = user.department_code || null;
    const facilityId = user.facility_id ? String(user.facility_id) : null;
    
    // Xác định quyền All-Access (Global)
    const isGlobal = role === 'SUPER_ADMIN' || 
                     role === 'VICE_PRESIDENT' || 
                     (role === 'DEPARTMENT_HEAD' && departmentCode === 'MARKETING');
                     
    return {
        isGlobal,
        departmentCode,
        facilityId
    };
}

async function testRevenue(user) {
    const args = {};
    const { date_range, facility_code } = args;
    
    const perms = getAiPermissions(user);
    
    if (!perms.isGlobal && facility_code && String(facility_code).toUpperCase().trim() !== String(perms.facilityId).toUpperCase().trim()) {
        console.warn('SECURITY ALERT');
        return;
    }

    const targetFacility = perms.isGlobal ? (facility_code ? String(facility_code) : null) : perms.facilityId;

    let startDate, endDate;

    if (date_range && typeof date_range === 'object' && date_range.startDate && date_range.endDate) {
        startDate = date_range.startDate;
        endDate = date_range.endDate;
    } else if (typeof date_range === 'string' && date_range.includes('-')) {
        const parts = date_range.split('-');
        startDate = parts[0]?.trim();
        endDate = parts[1]?.trim() || startDate; 
    } else {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        
        const formatToISO = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return ${year}--;
        };

        startDate = formatToISO(firstDay);
        endDate = formatToISO(today);
    }

    let sql = "";
    let params = [];

    if (!targetFacility) {
        sql = SELECT COALESCE(SUM(total_revenue), 0) AS aggregated_revenue 
               FROM daily_financial_reports 
               WHERE (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) >= (CASE WHEN $1::text LIKE '%-%' THEN $1::date ELSE to_date($1::text, 'DD/MM/YYYY') END) 
                 AND (CASE WHEN date LIKE '%-%' THEN date::date ELSE to_date(date, 'DD/MM/YYYY') END) <= (CASE WHEN $2::text LIKE '%-%' THEN $2::date ELSE to_date($2::text, 'DD/MM/YYYY') END);
        params = [startDate, endDate];
    } else {
        sql = "ELSE SQL";
        params = [startDate, endDate, targetFacility];
    }
    
    console.log("SQL generated for", user.role, ":", sql);
    console.log("Params:", params);
}

testRevenue(userFinance).catch(e => console.error(e));
testRevenue(userAdmin).catch(e => console.error(e));
