require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('./src/config/database');
const taskService = require('./src/services/taskService');

async function test() {
    // Giả lập user context y như authGuard
    const payload = {
        id: 'db41', // Từ ảnh chụp màn hình, id user là db41
        role: 'FACILITY_MANAGER',
        facility_id: 1, // Giả sử cơ sở 1
    };

    console.log("=== THỬ NGHIỆM TRUY VẤN VỚI FACILITY_MANAGER ===");
    try {
        const args = {
            userId: payload.id,
            role: payload.role,
            facilityId: payload.facility_id,
            departmentCode: null,
            status: null,
            limit: 50,
            offset: 0
        };

        const { totalRecords, rows } = await taskService.getTasksList(args);
        console.log(`Total Records: ${totalRecords}`);
        console.log("Tasks:");
        console.log(rows.map(r => ({ id: r.id, title: r.title, status: r.status })));
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

test();
