const express = require('express');
const router = express.Router();
// Use built-in fetch if Node >= 18, else require node-fetch. Assuming standard node environment.
// Actually require('node-fetch') might be needed if old Node. We can try global fetch, but we'll use dynamic import for node-fetch if global fetch is not available.
const fetch = global.fetch || require('node-fetch');
const authGuard = require('../middlewares/authGuard');

const getSystemAIConfig = async () => {
    return {
        aiModel: "google/gemini-3.1-pro-preview",
        apiKey: process.env.OPENROUTER_API_KEY
    };
};

router.post('/extract-revenue', authGuard, express.json({limit: '50mb'}), async (req, res) => {
  try {
    const { imageBase64, imageUrl } = req.body;
    
    const targetUrl = imageUrl || imageBase64;
    
    if (!targetUrl) {
      return res.status(400).json({ error: 'Thiếu dữ liệu hình ảnh (URL hoặc Base64).' });
    }

    const systemPrompt = `Đây là bảng doanh thu. Cột 1 là Thứ, Cột 2 là Ngày. Các cột tiếp theo là Doanh thu của DB41, ACE, PQ, PA, PAV, DB01. Hãy bỏ qua các hàng tiêu đề. Đọc từ hàng có chứa ngày tháng. Trả về mảng JSON: [{"date": "DD/MM/YYYY", "revenues": {"DUBAI 41": 100000, "DUBAI ACE": 200000, "DUBAI PHÚ QUỐC": 300000, "DUBAI PA": 400000, "DUBAI PAV": 500000, "DUBAI PAK": 600000}}]`;

    const payload = {
      model: "google/gemini-3.1-pro-preview",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: systemPrompt },
            { type: "image_url", image_url: { url: targetUrl } }
          ]
        }
      ]
    };

    const fetchFunc = fetch;
    const response = await fetchFunc("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, 
        "Content-Type": "application/json",
        "HTTP-Referer": "https://taskflow-ai-dashboard.onrender.com",
        "X-Title": "Stitch Smart AI"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter Response Error:", errText);
      return res.status(response.status).json({ error: 'Lỗi từ OpenRouter API.' });
    }

    const aiData = await response.json();
    let parsedData = [];
    
    if (aiData.choices && aiData.choices.length > 0) {
      const aiText = aiData.choices[0].message.content;
      const jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
         return res.status(500).json({ error: 'AI không trả về JSON hợp lệ.' });
      }
    }

    res.json({ success: true, data: parsedData });

  } catch (error) {
    console.error('Lỗi khi gọi AI Extract API:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ khi gọi AI API.' });
  }
});

router.post('/extract-revenue-text', authGuard, async (req, res) => {
  const { prompt, content } = req.body;
  if (!prompt || !content) {
    return res.status(400).json({ error: 'Thiếu dữ liệu prompt hoặc nội dung.' });
  }

  let parsedContent = [];
  try {
      parsedContent = JSON.parse(content);
  } catch (e) {
      return res.status(400).json({ error: 'Nội dung đầu vào không phải JSON hợp lệ.' });
  }
  if (!Array.isArray(parsedContent)) parsedContent = [parsedContent]; 

  const sanitizedContent = parsedContent
      .map(row => {
          if (!Array.isArray(row)) return row;
          return row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
      })
      .filter(row => Array.isArray(row) && row.length > 0);
  const optimizedContentStr = JSON.stringify(sanitizedContent);

  const strictSystemInstruction = `
[SYSTEM OVERRIDE INSTRUCTION]
You are a strict data extraction API. You MUST return ONLY a valid JSON object matching the requested schema.
DO NOT wrap the response in markdown block ticks (\`\`\`json).
DO NOT output any conversational text, greetings, or explanations.
Your entire response must be parseable by JSON.parse() immediately.
`;
  const finalPrompt = prompt + "\n" + strictSystemInstruction;

  const aiConfig = await getSystemAIConfig();
  
  const payload = {
    model: aiConfig.aiModel,
    messages: [
      { role: "system", content: finalPrompt },
      { role: "user", content: optimizedContentStr }
    ],
    response_format: { type: "json_object" }
  };

  let rawAiTextForLog = "";

  try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 40000);

      const fetchFunc = fetch;
      const response = await fetchFunc("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${aiConfig.apiKey}`, 
          "Content-Type": "application/json",
          "HTTP-Referer": "https://taskflow-ai-dashboard.onrender.com",
          "X-Title": "Stitch Smart AI"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[OPENROUTER_UPSTREAM_ERROR] Status: ${response.status} - Body: ${errText}`);
        if (response.status >= 500) {
            return res.status(502).json({ error: 'Dịch vụ AI đang gián đoạn (Bad Gateway), vui lòng thử lại sau.' });
        } else if (response.status === 402 || response.status === 429) {
            return res.status(503).json({ error: 'Dịch vụ AI đang quá tải hoặc hết Quota, vui lòng thử lại sau.' });
        }
        return res.status(502).json({ error: 'Lỗi từ kết nối OpenRouter API.' });
      }

      const aiData = await response.json();
      let parsedData = [];
      
      if (aiData.choices && aiData.choices.length > 0) {
        rawAiTextForLog = aiData.choices[0].message.content;
        const jsonMatch = rawAiTextForLog.match(/\[[\s\S]*\]/) || rawAiTextForLog.match(/\{[\s\S]*\}/);
        const textToParse = jsonMatch ? jsonMatch[0] : rawAiTextForLog;
        
        parsedData = JSON.parse(textToParse); 
        
        if (parsedData.data) parsedData = parsedData.data;
        if (!Array.isArray(parsedData)) parsedData = [parsedData];
      }

      res.json({ success: true, data: parsedData, usage: aiData?.usage });

  } catch (error) {
      if (error.name === 'AbortError') {
          console.error('[AI_NETWORK_TIMEOUT] Kết nối đến OpenRouter vượt quá thời gian chờ.');
          return res.status(504).json({ error: 'Dịch vụ AI đang quá tải (Gateway Timeout), vui lòng thử lại sau.' });
      }
      if (error instanceof SyntaxError && rawAiTextForLog) {
          console.error('[AI_PARSE_ERROR] DỮ LIỆU BỊ LỆCH CHUẨN CÚ PHÁP:\n', rawAiTextForLog);
          return res.status(422).json({ error: 'Dữ liệu AI trả về bị lệch chuẩn, vui lòng thử lại.' });
      }
      console.error('[AI_UNKNOWN_ERROR] Lỗi không xác định khi gọi AI:', error);
      return res.status(500).json({ error: 'Lỗi máy chủ nội bộ bất ngờ, vui lòng liên hệ Admin.' });
  }
});

// File mới upload chưa kịp lưu vào database sẽ không bị coi là rác trong khoảng thời gian này
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

// Tìm file trong bucket 'attachments' không còn được tham chiếu ở bất kỳ cột text/json nào của schema public.
// Quét mọi cột thay vì liệt kê tay từng bảng, để bảng/cột mới chứa URL không bị xóa nhầm file.
const findOrphanFiles = async () => {
  const pool = require('../config/database');
  const { listAllFiles } = require('../config/supabaseAdmin');

  const { rows: columns } = await pool.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')`
  );

  const quoteIdent = (name) => '"' + name.replace(/"/g, '""') + '"';
  const usedNames = new Set();
  for (const { table_name, column_name } of columns) {
    const col = quoteIdent(column_name);
    const { rows } = await pool.query(
      `SELECT DISTINCT m[1] AS name
         FROM public.${quoteIdent(table_name)},
              regexp_matches(${col}::text, '/attachments/([^"\\s?#\\\\]+)', 'g') AS m
        WHERE ${col}::text LIKE '%/attachments/%'`
    );
    for (const { name } of rows) {
      usedNames.add(name);
      try { usedNames.add(decodeURIComponent(name)); } catch { /* tên file không phải URL-encoded hợp lệ */ }
    }
  }

  const files = await listAllFiles('attachments');
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  const orphans = files.filter(f => !usedNames.has(f.name) && new Date(f.created_at).getTime() < cutoff);

  return { orphans, totalFiles: files.length };
};

// [ADMIN] Quét file rác trong Storage — dùng cho tính năng "Dọn Storage" trong Admin Panel
router.get('/storage/orphans', authGuard, async (req, res) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Không có quyền truy cập.' });
  }
  try {
    const { orphans, totalFiles } = await findOrphanFiles();
    res.json({
      success: true,
      total_files: totalFiles,
      orphans: orphans.map(f => ({ name: f.name, metadata: { size: f.metadata?.size || 0 }, created_at: f.created_at }))
    });
  } catch (error) {
    console.error('[storage/orphans] Lỗi:', error);
    res.status(500).json({ error: 'Lỗi server khi quét Storage.' });
  }
});

// [ADMIN] Xóa file rác. Server tự quét lại và chỉ xóa file vẫn còn là rác tại thời điểm xóa.
router.post('/storage/orphans/delete', authGuard, express.json(), async (req, res) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Không có quyền truy cập.' });
  }
  try {
    const requested = Array.isArray(req.body?.names) ? req.body.names : [];
    if (!requested.length) {
      return res.status(400).json({ error: 'Thiếu danh sách file cần xóa.' });
    }

    const { removeFromStorage } = require('../config/supabaseAdmin');
    const { orphans } = await findOrphanFiles();
    const stillOrphan = new Set(orphans.map(f => f.name));
    const toDelete = requested.filter(name => stillOrphan.has(name));

    const deleted = await removeFromStorage('attachments', toDelete);
    console.log(`[storage/orphans/delete] user=${req.user.id} yêu cầu=${requested.length} đã xóa=${deleted}`);
    res.json({ success: true, deleted, skipped: requested.length - toDelete.length });
  } catch (error) {
    console.error('[storage/orphans/delete] Lỗi:', error);
    res.status(500).json({ error: 'Lỗi server khi xóa file rác.' });
  }
});

// Ghi nhận lịch sử sử dụng AI token sau mỗi lần trích xuất doanh thu
router.post('/log-tokens', authGuard, async (req, res) => {
  try {
    const { username, prompt_tokens, completion_tokens, total_tokens } = req.body;
    const userId = req.user?.id || null;
    const userRole = req.user?.role || req.headers['x-user-role'] || 'unknown';

    const pool = require('../config/database');

    // Tạo bảng nếu chưa tồn tại
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_token_usage_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        username TEXT,
        user_role TEXT,
        feature TEXT DEFAULT 'extract-revenue',
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Chặn truy cập qua anon key (PostgREST); backend dùng role postgres nên không bị ảnh hưởng
    await pool.query(`ALTER TABLE ai_token_usage_logs ENABLE ROW LEVEL SECURITY`);

    // Migration: Thêm cột còn thiếu nếu bảng đã tồn tại với schema cũ (cột "role" thay vì "user_role")
    await pool.query(`ALTER TABLE ai_token_usage_logs ADD COLUMN IF NOT EXISTS user_role TEXT`);
    await pool.query(`ALTER TABLE ai_token_usage_logs ADD COLUMN IF NOT EXISTS feature TEXT DEFAULT 'extract-revenue'`);

    await pool.query(
      `INSERT INTO ai_token_usage_logs
        (user_id, username, user_role, feature, prompt_tokens, completion_tokens, total_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        username || req.user?.name || req.user?.username || 'unknown',
        userRole,
        'extract-revenue',
        prompt_tokens || 0,
        completion_tokens || 0,
        total_tokens || 0
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[log-tokens] Lỗi ghi token usage:', error);
    res.status(500).json({ error: 'Lỗi khi ghi nhận token usage.' });
  }
});

module.exports = router;
