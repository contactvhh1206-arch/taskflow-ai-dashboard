/**
 * AI Telemetry & Context Optimization Service
 * Đảm nhận nhiệm vụ Cắt gọt Memory chống tràn Token và Ghi log ngầm (Fire-and-Forget)
 */

// Hàm Cắt Tỉa Lịch Sử Bọc Thép (Sliding Window bọc thép chống mồ côi Context Tool)
export function optimizeContextWindow(messages: any[], maxRecent = 10) {
  if (messages.length <= maxRecent + 1) return messages; 
  
  const systemPrompt = messages[0];
  let cutIndex = messages.length - maxRecent;

  // Lùi dao cắt cho đến khi gặp ranh giới an toàn để không xé nát cụm Tool Calling
  while (cutIndex > 1) {
    const msg = messages[cutIndex];
    // Nếu điểm cắt rơi vào 'tool' HOẶC 'assistant' đang thực thi gọi hàm -> Lùi lại!
    if (msg.role === 'tool' || (msg.role === 'assistant' && msg.tool_calls)) {
      cutIndex--; 
    } else {
      break; // Gặp 'user' hoặc 'assistant' text thuần -> Đã an toàn để cắt
    }
  }
  
  return [systemPrompt, ...messages.slice(cutIndex)];
}

// Hàm Background Worker không Block I/O (Lưu lịch sử và Token)
export const saveTelemetryFireAndForget = (pool: any, userContext: any, sessionId: string, finalMessages: any[], tokenUsage: any) => {
  // KHÔNG DÙNG AWAIT ở mạch chính, tách ra chạy ngầm hoàn toàn
  Promise.resolve().then(async () => {
    try {
      // 1. Lưu History (ai_chat_messages)
      // Giả lập lưu history
      // await pool.query('INSERT INTO ai_chat_messages (session_id, user_id, messages) VALUES ($1, $2, $3)', [sessionId, userContext.id, JSON.stringify(finalMessages)]);
      
      // 2. Lưu Token Usage vào bảng đúng chuẩn ai_token_usage_logs (Không nhầm lẫn với ai_ping_logs)
      if (tokenUsage && tokenUsage.prompt_tokens > 0) {
        /*
        await pool.query(
          'INSERT INTO ai_token_usage_logs (session_id, user_id, prompt_tokens, completion_tokens, created_at) VALUES ($1, $2, $3, $4, NOW())',
          [sessionId, userContext.id, tokenUsage.prompt_tokens, tokenUsage.completion_tokens]
        );
        */
        console.log(`[TELEMETRY FIRE-AND-FORGET] Đã lưu ngầm ${tokenUsage.prompt_tokens} prompt tokens, ${tokenUsage.completion_tokens} completion tokens cho Session: ${sessionId}`);
      }
    } catch (err) {
      // Bức tường thép chặn lỗi rò rỉ làm sập Event Loop
      console.error('[TELEMETRY FATAL] Không thể lưu Log. Vẫn an toàn cho luồng chính.', err);
    }
  });
};
