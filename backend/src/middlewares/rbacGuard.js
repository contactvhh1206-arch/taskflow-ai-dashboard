const rbacGuard = (req, res, next) => {
    try {
        // 1. Tuyến đường xanh: Mở cổng ngay cho nhóm Toàn quyền
        if (req.user && req.user.is_global_access) {
            return next();
        }

        // 2. Trích xuất facility_id từ Request
        const method = req.method;
        let passedFacilityId = null;

        if (['GET', 'DELETE'].includes(method)) {
            passedFacilityId = req.query?.facility_id;
        } else if (['POST', 'PUT', 'PATCH'].includes(method)) {
            passedFacilityId = req.body?.facility_id;
        }

        // 3. Quy tắc Hard Block (Chống HPP & Lỗ hổng NaN)
        if (passedFacilityId !== undefined && passedFacilityId !== null && passedFacilityId !== '') {
            // Chặn ngay lập tức nếu truyền Mảng (Array Injection)
            if (Array.isArray(passedFacilityId)) {
                return res.status(400).json({
                    success: false,
                    message: "Bad Request: Tham số facility_id không được phép là mảng."
                });
            }

            const parsedPassedId = Number(passedFacilityId);
            
            // Chặn cứng nếu là NaN HOẶC khác với facility_id của User
            if (isNaN(parsedPassedId) || parsedPassedId !== req.user.facility_id) {
                return res.status(403).json({
                    success: false,
                    message: "RBAC_VIOLATION: AI Agent hoặc User không có quyền truy cập cơ sở dữ liệu của chi nhánh này."
                });
            }
        }

        // 4. Quy tắc Inject ngầm chống Rò rỉ Dữ liệu (Bảo vệ Controller)
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
            if (!req.body) req.body = {};
            if (req.body.facility_id === undefined || req.body.facility_id === null || req.body.facility_id === '') {
                req.body.facility_id = req.user.facility_id;
            }
        } else if (['GET', 'DELETE'].includes(method)) {
            if (!req.query) req.query = {};
            if (req.query.facility_id === undefined || req.query.facility_id === null || req.query.facility_id === '') {
                req.query.facility_id = req.user.facility_id;
            }
        }

        next();
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error during RBAC validation.'
        });
    }
};

module.exports = rbacGuard;
