import { Request, Response } from 'express';
import { AiAuditService } from '../services/aiAuditService';
const ragService = require('../src/services/ragService');

export const streamAIChat = async (req: Request, res: Response) => {
  const message = req.body.message;
  const userRole = req.body.context?.role || 'UNKNOWN';
  const facilityId = req.body.context?.facilityId || 'UNKNOWN';
  const userId = (req as any).user?.id || 'SYSTEM_USER'; 

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform'); // Chặn nén
  res.setHeader('X-Accel-Buffering', 'no'); // TỬ HUYỆT XUYÊN THỦNG NGINX RENDER!
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // ÉP XẢ HEADER NGAY LẬP TỨC
  
  let fullAiResponse = '';
  let isSavedToDB = false;
  let backendBuffer = ''; 
  
  const openRouterAbortController = new AbortController();

  req.on('close', async () => {
    openRouterAbortController.abort();
    if (!isSavedToDB) {
      isSavedToDB = true;
      if (fullAiResponse.trim()) {
        try {
          const payload = {
            user_id: userId,
            facility_id: facilityId,
            department_code: (req as any).user?.department_code || 'UNKNOWN',
            task_type: req.body.task_type || 'Advisor',
            status: 'Lỗi', // Đóng sớm
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            chat_prompt: message,
            chat_response: fullAiResponse,
            is_violation: false
          };
          AiAuditService.executeGhostAudit(payload);
        } catch (payloadError: any) {
          console.error('[Controller Hook Error]: Xây dựng Payload thất bại:', payloadError.message);
        }
      }
    }
  });

  try {
    let ragContextStr = '';
    try {
      const userContext = { 
        id: userId, 
        role: userRole, 
        facility_id: facilityId, 
        department_code: (req as any).user?.department_code || '' 
      };
      const ragResults = await ragService.searchKnowledgeBase(message, userContext, 20);
      if (ragResults && ragResults.length > 0) {
        const ragTexts = ragResults.filter((r: any) => r.content && !r.content.startsWith('Hệ thống từ chối')).map((r: any) => {
            const fileName = typeof r.metadata === 'object' ? r.metadata?.filename : (r.metadata ? JSON.parse(r.metadata).filename : 'Không rõ');
            return `[Nguồn tài liệu: ${fileName || 'Không rõ'}]\n${r.content}`;
        });
        if (ragTexts.length > 0) {
            ragContextStr = '\n\n[DỮ LIỆU NỘI BỘ THAM KHẢO (RAG)]:\n' + ragTexts.join('\n---\n');
        }
      }
    } catch (e: any) {
      console.error('Lỗi khi truy vấn RAG:', e.message);
    }

    const systemPrompt = `Bạn là AI Agent của TaskFlow. Người dùng có Role: ${userRole}, ID Cơ sở: ${facilityId}. Hôm nay là ngày ${new Date().toLocaleDateString('vi-VN')}. Tuyệt đối tuân thủ phân quyền và lưu ý mốc thời gian của từng báo cáo trong RAG context.${ragContextStr}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'google/gemini-3.1-pro-preview', 
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        stream: true,
        max_tokens: 4000
      }),
      signal: openRouterAbortController.signal
    });

    if (!response.body) throw new Error('No response body stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
      
      backendBuffer += chunk;
      const lines = backendBuffer.split('\n\n');
      
      backendBuffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        if (trimmedLine.startsWith('data: ')) {
          const dataPayload = trimmedLine.replace(/^data:\s*/, '');
          if (dataPayload === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(dataPayload);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullAiResponse += content;
            }
          } catch (parseError) {
            console.warn('Backend parsing warning for chunk:', dataPayload);
          }
        }
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
    
    if (!isSavedToDB) {
      isSavedToDB = true;
      if (fullAiResponse.trim()) {
        try {
          const targetFacility = req.body.target_facility || null;
          const isViolation = targetFacility && facilityId !== targetFacility;

          const payload = {
            user_id: userId,
            facility_id: facilityId,
            department_code: (req as any).user?.department_code || 'UNKNOWN',
            task_type: req.body.task_type || 'Advisor',
            status: 'OK', 
            prompt_tokens: 0, 
            completion_tokens: 0,
            total_tokens: 0,
            chat_prompt: message,
            chat_response: fullAiResponse,
            is_violation: !!isViolation
          };
          AiAuditService.executeGhostAudit(payload);
        } catch (payloadError: any) {
          console.error('[Controller Hook Error]: Xây dựng Payload thất bại:', payloadError.message);
        }
      }
    }
    
  } catch (error: any) {
    if (error.name === 'AbortError') {
        console.warn('[NETWORK WARNING] OpenRouter stream aborted.');
    } else {
        console.error('[STREAM FATAL ERROR]', error);
        res.write(`data: ${JSON.stringify({ error: 'Stream processing fatal error' })}\n\n`);
        res.end();
    }
  }
};
