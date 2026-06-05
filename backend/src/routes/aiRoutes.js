const express = require('express');
const router = express.Router();
const authGuard = require('../middlewares/authGuard');
const rbacGuard = require('../middlewares/rbacGuard');
const aiController = require('../controllers/aiController');

// Luồng Stream AI được bọc thép và chạy cơ chế Sandbox
router.post('/chat/stream', authGuard, rbacGuard, aiController.chatStreamHandler);

module.exports = router;
