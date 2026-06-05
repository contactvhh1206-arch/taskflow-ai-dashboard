const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const taskRoutes = require('./taskRoutes');
const aiRoutes = require('./aiRoutes');
const facilityRoutes = require('./facilityRoutes');
const kpiRoutes = require('./kpiRoutes');
const logRoutes = require('./logRoutes');
const reportRoutes = require('./reportRoutes');
const checkinRoutes = require('./checkinRoutes');

// Trạm Giao thông Tổng
router.use('/auth', authRoutes);
router.use('/tasks', taskRoutes);
router.use('/ai', aiRoutes);
router.use('/facilities', facilityRoutes);
router.use('/kpi', kpiRoutes);
router.use('/logs', logRoutes);
router.use('/reports', reportRoutes);
router.use('/checkin', checkinRoutes);
router.use('/ai-ping', require('./aiPingRoutes'));
module.exports = router;
