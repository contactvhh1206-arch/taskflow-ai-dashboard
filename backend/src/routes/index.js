const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const taskRoutes = require('./taskRoutes');
const aiRoutes = require('./aiRoutes');
const facilityRoutes = require('./facilityRoutes');
const kpiRoutes = require('./kpiRoutes');
const logRoutes = require('./logRoutes');

// Trạm Giao thông Tổng
router.use('/auth', authRoutes);
router.use('/tasks', taskRoutes);
router.use('/ai', aiRoutes);
router.use('/facilities', facilityRoutes);
router.use('/kpi', kpiRoutes);
router.use('/logs', logRoutes);

module.exports = router;
