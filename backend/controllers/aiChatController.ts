import { Request, Response } from 'express';

const saveChatToDatabase = async (userId: string, facilityId: string, userMessage: string, aiMessage: string) => {
    console.log(`[DB SUCCESS] Saved ${aiMessage.length} clean text chars for User ${userId} at Facility ${facilityId}.`);
};

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
          await saveChatToDatabase(userId, facilityId, message, fullAiResponse);
        } catch (dbError) {
          console.error('[DB FATAL ON CLOSE]', dbError);
        }
      }
    }
  });

  try {
    const systemPrompt = `Bạn là AI Agent của TaskFlow. Người dùng có Role: ${userRole}, ID Cơ sở: ${facilityId}. Tuyệt đối tuân thủ phân quyền và RAG context.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo', 
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        stream: true
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
    
    if (!isSavedToDB) {
      isSavedToDB = true;
      if (fullAiResponse.trim()) {
        try {
          await saveChatToDatabase(userId, facilityId, message, fullAiResponse);
        } catch (dbError) {
          console.error('[DB FATAL ON SUCCESS]', dbError);
        }
      }
    }
    res.end();
    
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
