const express = require('express');
const router = express.Router();
// Use built-in fetch if Node >= 18, else require node-fetch. Assuming standard node environment.
// Actually require('node-fetch') might be needed if old Node. We can try global fetch, but we'll use dynamic import for node-fetch if global fetch is not available.
const fetch = global.fetch || require('node-fetch');
const authGuard = require('../middlewares/authGuard');

const getSystemAIConfig = async () => {
    return {
        aiModel: "anthropic/claude-3.5-sonnet",
        apiKey: process.env.OPENROUTER_API_KEY
    };
};

router.post('/extract-revenue', express.json({limit: '50mb'}), async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ error: 'Thiếu dữ liệu hình ảnh (Base64).' });
    }

    const systemPrompt = `Đây là bảng doanh thu. Cột 1 là Thứ, Cột 2 là Ngày. Các cột tiếp theo là Doanh thu của DB41, ACE, PQ, PA, PAV, DB01. Hãy bỏ qua các hàng tiêu đề. Đọc từ hàng có chứa ngày tháng. Trả về mảng JSON: [{"date": "DD/MM/YYYY", "revenues": {"DUBAI 41": 100000, "DUBAI ACE": 200000, "DUBAI PHÚ QUỐC": 300000, "DUBAI PA": 400000, "DUBAI PAV": 500000, "DUBAI PAK": 600000}}]`;

    const payload = {
      model: "anthropic/claude-3.5-sonnet",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: systemPrompt },
            { type: "image_url", image_url: { url: imageBase64 } }
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

module.exports = router;
