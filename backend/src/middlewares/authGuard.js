const jwt = require('jsonwebtoken');

const authGuard = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized: Missing or invalid Authorization header' 
            });
        }

        const token = authHeader.split(' ')[1];
        
        // Giải mã JWT hoàn toàn Stateless (Không chạm Database)
        const payload = jwt.verify(token, process.env.SECRET_KEY || 'YOUR_SECRET_KEY');
        
        // Ép kiểu facility_id an toàn
        let facilityIdParsed = null;
        if (payload.facility_id && payload.facility_id !== 'ALL') {
            const parsed = Number(payload.facility_id);
            if (!isNaN(parsed)) {
                facilityIdParsed = parsed;
            }
        }

        // Định danh cờ Toàn quyền (Global Access)
        const globalRoles = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD', 'ADMIN'];
        const isGlobalAccess = globalRoles.includes(payload.role);

        // Chuẩn hóa req.user
        req.user = {
            id: payload.id,
            role: payload.role,
            facility_id: facilityIdParsed,
            department_code: payload.department_code || null,
            is_global_access: isGlobalAccess,
            managed_facilities: payload.managed_facilities || null
        };

        next();
    } catch (err) {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized: Invalid or Expired Token' 
        });
    }
};

module.exports = authGuard;
