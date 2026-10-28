// Chặn theo vai trò. Dùng SAU authGuard (cần req.user.role).
// Ví dụ: router.post('/', authGuard, requireRoles('FINANCE_DEPT', 'SUPER_ADMIN'), handler)
const requireRoles = (...allowedRoles) => (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Vai trò của bạn không có quyền thực hiện thao tác này.'
        });
    }
    next();
};

module.exports = requireRoles;
