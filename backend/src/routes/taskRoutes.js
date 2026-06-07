const express = require('express');
const router = express.Router();
const authGuard = require('../middlewares/authGuard');
const rbacGuard = require('../middlewares/rbacGuard');
const taskController = require('../controllers/taskController');

// Tuyến đường đã được bọc thép bằng 2 lớp Khiên
router.get('/', authGuard, rbacGuard, taskController.getTasksHandler);
router.get('/history', authGuard, rbacGuard, taskController.getTasksHistoryHandler);

// [MỚI] Mở lại cổng POST để khởi tạo công việc
router.post('/', authGuard, rbacGuard, taskController.createTaskHandler);

module.exports = router;
