const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authGuard = require('../middlewares/authGuard');
// [FIX VẤN ĐỀ 4] Import hàm invalidate cache để xóa cache ngay khi admin lưu config mới
const { invalidateAIConfigCache } = require('../controllers/aiController');

router.get('/', authGuard, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM system_config');
        const data = {};
        rows.forEach(row => {
            const k = row.key || row.config_key || row.setting_key || row.name;
            const v = row.value !== undefined ? row.value : (row.data !== undefined ? row.data : (row.config_value !== undefined ? row.config_value : row.setting_value));
            if (k) data[k] = v;
        });

        // [BẢO MẬT] Che API key trong response — không bao giờ trả key thật về frontend
        // Frontend chỉ cần biết key đã được cấu hình hay chưa, không cần giá trị thật
        if (data.taskflow_ai_config) {
            try {
                let aiCfg = data.taskflow_ai_config;
                if (typeof aiCfg === 'string') aiCfg = JSON.parse(aiCfg);
                const hasKey = !!(aiCfg.apiKey && aiCfg.apiKey.length > 0);
                // Chỉ trả về model và trạng thái key, không trả key thật
                data.taskflow_ai_config = JSON.stringify({
                    aiModel: aiCfg.aiModel || '',
                    webhookUrl: aiCfg.webhookUrl || '',
                    apiKey: hasKey ? '***CONFIGURED***' : '',
                    hasApiKey: hasKey
                });
            } catch (e) {
                // Nếu parse lỗi, xóa luôn để an toàn
                data.taskflow_ai_config = JSON.stringify({ apiKey: '', hasApiKey: false });
            }
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Lỗi khi lấy config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', authGuard, async (req, res) => {
    try {
        const { ai_config, system_prompts } = req.body;
        
        // Dò tìm tên cột tự động
        const { rows: cols } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'system_config'");
        const colNames = cols.map(c => c.column_name);
        const keyCol = colNames.find(c => ['key', 'config_key', 'setting_key', 'name'].includes(c)) || 'key';
        const valCol = colNames.find(c => ['value', 'data', 'config_value', 'setting_value'].includes(c)) || 'value';

        const upsertConfig = async (k, v) => {
            const { rows } = await pool.query(`SELECT ${keyCol} FROM system_config WHERE ${keyCol} = $1`, [k]);
            if (rows.length > 0) {
                await pool.query(`UPDATE system_config SET ${valCol} = $2 WHERE ${keyCol} = $1`, [k, JSON.stringify(v)]);
            } else {
                await pool.query(`INSERT INTO system_config (${keyCol}, ${valCol}) VALUES ($1, $2)`, [k, JSON.stringify(v)]);
            }
        };

        if (ai_config) await upsertConfig('taskflow_ai_config', ai_config);
        if (system_prompts) await upsertConfig('taskflow_system_prompts', system_prompts);

        // [FIX VẤN ĐỀ 4] Xóa cache ngay lập tức sau khi lưu thành công
        // → Request chat tiếp theo sẽ đọc lại từ DB và dùng model mới ngay
        if (ai_config && invalidateAIConfigCache) invalidateAIConfigCache();

        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi khi lưu config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
