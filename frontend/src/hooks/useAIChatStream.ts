import { useState, useRef, useCallback, useEffect } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function useAIChatStream(options?: {
  sessionId?: string | null;
  initialMessages?: Message[];
  onSessionCreated?: (sessionId: string) => void;
  onSessionUpdate?: (data: any) => void;
  onStreamComplete?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const streamingTextRef = useRef<string>('');
  const lastUpdateRef = useRef<number>(0);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isUserAbortedRef = useRef<boolean>(false); // Cờ theo dõi nguyên nhân ngắt luồng
  const [streamError, setStreamError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const sessionIdRef = useRef<string | null>(options?.sessionId || null);

  useEffect(() => {
    if (options?.sessionId) {
      sessionIdRef.current = options.sessionId;
    }
  }, [options?.sessionId]);

  // Ép đồng bộ State nội bộ khi API Lịch sử trả về
  useEffect(() => {
    if (options?.initialMessages) {
      setMessages((prev) => {
        // KHIÊN BỌC THÉP: Nếu State hiện tại (prev) đang có nhiều tin nhắn hơn Lịch sử (do User vừa chat thêm),
        // TUYỆT ĐỐI BỎ QUA việc nạp đè để bảo vệ tin nhắn Real-time!
        if (prev.length > options.initialMessages!.length) {
          return prev;
        }
        return options.initialMessages!;
      });
    } else {
      setMessages([]);
    }
  }, [options?.initialMessages]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendMessage = useCallback(async (content: string, contextPayload: any) => {
    // [FIX DOUBLE-FIRE]: Chặn ngay lập tức nếu luồng đang bận, KHÔNG TỰ SÁT LUỒNG CŨ
    if (isStreamingRef.current) {
      console.warn("Luồng đang bận, từ chối gửi đúp tin nhắn.");
      return;
    }

    isUserAbortedRef.current = false; // Mở cờ trạng thái khởi tạo

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    isStreamingRef.current = true;
    setIsThinking(true);
    setIsStreaming(false);
    setStreamError(null); // Reset lỗi cũ

    const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random()}`;

    setMessages((prev) => [
      ...prev, 
      { id: generateId(), role: 'user', content, attachment: contextPayload?.attachment }
    ]);
    
    setStreamingText('');
    streamingTextRef.current = '';
    lastUpdateRef.current = Date.now();

    try {
      let chatEndpoint = '';
      try {
        let rawBase = import.meta.env.VITE_API_BASE_URL?.replace(/^["']|["']$/g, '').trim();
        
        // AUTO-CORRECTION BỌC THÉP
        if (rawBase && !rawBase.startsWith('http')) {
            console.warn('[CẢNH BÁO MÔI TRƯỜNG] VITE_API_BASE_URL thiếu Protocol. Hệ thống tự động gắn https://');
            rawBase = 'https://' + rawBase; 
        }

        const baseURL = rawBase || 'https://taskflow-ai-dashboard.onrender.com';
        chatEndpoint = new URL('/api/ai/chat-stream', baseURL).toString();

      } catch (err) {
        throw new Error('SYSTEM_ERROR: Trình duyệt không thể phân giải đường dẫn mạng.');
      }

      const response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('taskflow_token') || ''}`
        },
        body: JSON.stringify({ 
          message: content, 
          session_id: sessionIdRef.current || contextPayload?.sessionId, 
          attachment: contextPayload?.attachment,
          context: contextPayload 
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        if (response.status === 500) {
            throw new Error('SERVER_INTERNAL_ERROR');
        }
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      let isFirstChunk = true;
      while (true) {
        const { done, value } = await reader.read();

        if (isFirstChunk) {
            setIsThinking(false);
            setIsStreaming(true);
            isFirstChunk = false;
        }

        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
        }

        const lines = buffer.split(/\n/);
        buffer = lines.pop() || ''; 

        let chunkTextToAppend = '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          if (trimmedLine.startsWith('data: ')) {
            const dataPayload = trimmedLine.replace(/^data:\s*/, '');
            if (dataPayload === '[DONE]') continue;
            
            // --- BƯỚC 2 FIX: BẮT CỜ LỖI SERVER TRONG QUÁ TRÌNH STREAM ---
            if (dataPayload === '[DONE_WITH_ERROR]') {
                setStreamError("Sự cố hệ thống AI nội bộ (Error 500). Vui lòng liên hệ Admin.");
                
                setStreamingText('');
                streamingTextRef.current = '';
                chunkTextToAppend = ''; // Dọn sạch buffer tức thời
                
                // Ném lỗi nội bộ để văng thẳng xuống Catch, cắt đứt hoàn toàn vòng lặp while(true)
                throw new Error('SERVER_INTERNAL_ERROR'); 
            }
            
            try {
              const data = JSON.parse(dataPayload);
              
              if (data.sessionId) {
                  // [GIAI ĐOẠN 2]: Khóa cứng ID ngay lập tức xuống Ref để chặn đúp session ảo!
                  sessionIdRef.current = data.sessionId;
                  
                  if (optionsRef.current?.onSessionCreated) {
                      optionsRef.current.onSessionCreated(data.sessionId);
                  }
                  continue; 
              }
              
              // ====================================================
              // CHỮA BỆNH MÙ LÒA FRONTEND: BẮT LỖI TỪ API TRẢ VỀ
              // ====================================================
              if (data?.error) {
                  // Ép kiểu an toàn (Do Backend trả về chuỗi trực tiếp)
                  const errorDetail = typeof data.error === 'string' ? data.error : (data.error?.message || data.error?.type || "Lỗi Hệ thống Thần kinh AI không xác định");
                  
                  // Không nhét lỗi vào mảng messages nữa, tách ra UI Box riêng
                  setStreamError(`[Lỗi Hệ Thống]: ${errorDetail}`);
                  
                  setStreamingText('');
                  streamingTextRef.current = '';
                  chunkTextToAppend = ''; // Xóa buffer tạm
                  
                  // Ép UI tắt trạng thái Thinking & Tắt cờ Race Condition
                  setIsThinking(false);
                  setIsStreaming(false);
                  isStreamingRef.current = false;
                  
                  // Ném lỗi để thoát thẳng ra Outer Catch, ngăn chặn khối if (done) hoặc AbortError đè lỗi
                  throw new Error('API_STREAM_ERROR');
              }

              // Sử dụng Optional Chaining an toàn để lấy chuỗi Stream
              const chunk = data?.choices?.[0]?.delta?.content || data?.content || data?.text || '';
              console.log('--- STREAM CHUNK ---', chunk); // [TRAP 1] BẪY LƯỚI BỘ NHỚ
              if (chunk) {
                  chunkTextToAppend += chunk;
              }
            } catch (parseError) {
              console.error('--- [TRAP 1] JSON PARSE ERROR ---', parseError, 'PAYLOAD:', dataPayload); // [TRAP 1]
              console.warn('[Luồng Thép] Bỏ qua chunk vỡ ngầm:', dataPayload);
            }
          }
        }

        if (chunkTextToAppend) {
          streamingTextRef.current += chunkTextToAppend;
          const now = Date.now();
          if (now - lastUpdateRef.current > 50) {
            setStreamingText(streamingTextRef.current);
            lastUpdateRef.current = now;
          }
        }

        if (done) {
           if (buffer.trim().startsWith('data: ') && !buffer.includes('[DONE]')) {
              try {
                  const finalPayload = buffer.trim().replace(/^data:\s*/, '');
                  const finalParsed = JSON.parse(finalPayload);
                  const finalContent = finalParsed.content || finalParsed.text || finalParsed.choices?.[0]?.delta?.content || "";
                  if (finalContent) {
                      streamingTextRef.current += finalContent;
                  }
              } catch (e) {}
           }
           
           const finalContentToSave = streamingTextRef.current;
           if (finalContentToSave.trim() !== '') {
               // BẮT CHẾT CHUỖI MỒI CỦA CỐ VẤN AI
               if (finalContentToSave.includes("Đang truy cập kho dữ liệu hệ thống...")) {
                   setStreamError("Lỗi hệ thống AI: Không thể tổng hợp báo cáo từ kho dữ liệu.");
               } else {
                   const finalId = generateId();
                   setMessages((prev) => [
                     ...prev,
                     { id: finalId, role: 'assistant', content: finalContentToSave }
                   ]);
               }
           }
           
           setStreamingText('');
           streamingTextRef.current = '';
           
           break;
        }
      }
    } catch (error: any) {
      console.error('--- [TRAP 1] OUTER CATCH STREAM ERROR ---', error); // [TRAP 1]
      const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `msg-${Date.now()}`;

      // 1. NẾU LÀ LỖI HỆ THỐNG NỘI BỘ HOẶC BẮT ĐƯỢC TỪ [DONE_WITH_ERROR]
      if (error.message === 'SERVER_INTERNAL_ERROR') {
          console.error('[Luồng Thép AI] Đã ngắt luồng do Server báo lỗi 500 (Internal Error).');
          // Fallback UI bằng Error State thay vì lưu vào DB
          if (!streamError) {
              setStreamError("Sự cố hệ thống AI nội bộ (Error 500). Vui lòng liên hệ Admin.");
          }
          setStreamingText('');
          streamingTextRef.current = '';
      }
      // 1.5. NẾU BẮT ĐƯỢC LỖI TRỰC TIẾP TỪ OPENROUTER/API (Ném từ trong parse)
      else if (error.message === 'API_STREAM_ERROR') {
          console.error('[Luồng Thép AI] Ngắt luồng do API LLM trả về lỗi. Lỗi nguyên thủy đã được bảo tồn.');
          // Đã gọi setStreamError ở trên, không làm gì thêm để bảo vệ thông báo lỗi.
      }
      // 2. CHỈ HIỂN THỊ "LỖI MẠNG / DDoS" KHI MẤT KẾT NỐI HOẶC BỊ RATE LIMIT THẬT SỰ
      else if (error.name === 'AbortError' || error.name === 'CanceledError' || error.message.includes('429') || error.message === 'Failed to fetch') {
        if (isUserAbortedRef.current) {
           console.warn('[Luồng Thép AI] Người dùng đã chủ động dừng tạo phản hồi (Normal Behavior).');
        } else {
           console.error('[Luồng Thép AI] Luồng Stream bị đứt kết nối ngầm do lỗi mạng hoặc Server Rate Limit (DDoS)!');
           setStreamError('Lỗi gián đoạn kết nối do mạng không ổn định hoặc quá tải băng thông. Vui lòng thử lại sau giây lát.');
           setStreamingText('');
           streamingTextRef.current = '';
        }
      } 
      // 3. CÁC LỖI KHÁC (Parse JSON lỗi, HTTP status lạ...)
      else {
        console.error('Stream processing error:', error);
        setStreamError('Mạng chập chờn, luồng AI bị ngắt quãng');
        setStreamingText('');
        streamingTextRef.current = '';
      }
      
      // [BỌC THÉP UI]: Mở khóa cờ Race Condition và giải phóng giao diện ngay lập tức
      setIsThinking(false);
      setIsStreaming(false);
      isStreamingRef.current = false;
      
    } finally {
      if (abortControllerRef.current === abortController) {
        isStreamingRef.current = false;
        setIsStreaming(false);
        setIsThinking(false);
        if (optionsRef.current?.onStreamComplete) optionsRef.current.onStreamComplete();
        abortControllerRef.current = null;
      }
    }
  }, []);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      isUserAbortedRef.current = true; // Lệnh Khóa: Khẳng định đây là hành động chủ ý của User
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      isStreamingRef.current = false;
      setIsStreaming(false);
      setIsThinking(false);
    }
  }, []);

  return {
    messages,
    streamingText,
    streamError,
    sendMessage,
    isStreaming,
    isThinking,
    stopStream,
    setMessages,
    setStreamError
  };
}
