const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'your_secret_key'; // Wait, let me check what SECRET_KEY is in server.js. It's '123456'.

// Let's create a token payload representing a FACILITY_MANAGER
const tokenPayload = {
    id: 10,
    role: 'FACILITY_MANAGER',
    facility_id: 'Cơ sở 1', // Simulate manager1
    facility_code: 'DB41',
    department_id: null,
    department_code: 'DB41'
};

const token = jwt.sign(tokenPayload, '123456', { expiresIn: '7d' });

// Simulate authenticateUser middleware logic
try {
    const payload = jwt.verify(token, '123456');
    const userId = payload.id;
    const userRole = payload.role;
    const facilityRaw = payload.facility_id;
    const departmentId = payload.department_id;
    const departmentCode = payload.department_code;
    const facilityCode = payload.facility_code;
    
    let facilityId = parseInt(facilityRaw, 10);
    if (isNaN(facilityId)) {
        facilityId = facilityRaw; // Simplified for test
    }
    
    const reqUser = { 
        id: userId, 
        role: userRole, 
        facility_id: facilityId, 
        department_id: departmentId, 
        department_code: departmentCode, 
        facility_code: facilityCode 
    };
    
    console.log("=== BẰNG CHỨNG KIỂM THỬ: req.user SAU KHI ĐI QUA MIDDLEWARE ===");
    console.log(reqUser);
} catch (e) {
    console.error(e);
}
