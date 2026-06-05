const express = require('express');
const router = express.Router();
const authGuard = require('../middlewares/authGuard');
const rbacGuard = require('../middlewares/rbacGuard');
const aiController = require('../controllers/aiController');

// Luồng Stream AI được bọc thép và chạy cơ chế Sandbox
router.post('/chat-stream', authGuard, rbacGuard, aiController.chatStreamHandler);

// Ping Batch
router.post('/ping-batch', authGuard, rbacGuard, aiController.pingBatchHandler);

// Quản lý Sessions
router.get('/sessions', authGuard, aiController.getSessionsHandler);
router.post('/sessions', authGuard, aiController.createSessionHandler);
router.get('/chat-sessions/:id/messages', authGuard, aiController.getMessagesHandler);

module.exports = router;
