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

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

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
    isUserAbortedRef.current = false; // Mở cờ trạng thái khởi tạo

    if (isStreamingRef.current) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    isStreamingRef.current = true;
    setIsThinking(true);
    setIsStreaming(false);

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
          session_id: contextPayload?.sessionId, 
          attachment: contextPayload?.attachment,
          context: contextPayload 
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
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
            
            try {
              const data = JSON.parse(dataPayload);
              
              if (data.sessionId && optionsRef.current?.onSessionCreated) {
                  optionsRef.current.onSessionCreated(data.sessionId);
                  continue; 
              }
              
              // ====================================================
              // CHỮA BỆNH MÙ LÒA FRONTEND: BẮT LỖI TỪ API TRẢ VỀ
              // ====================================================
              if (data?.error) {
                  // Ép kiểu an toàn (Do Backend trả về chuỗi trực tiếp)
                  const errorDetail = typeof data.error === 'string' ? data.error : (data.error?.message || data.error?.type || "Lỗi Hệ thống Thần kinh AI không xác định");
                  
                  // Ép state React cập nhật ngay lập tức tin nhắn báo lỗi này vào mảng hiển thị
                  const errorContent = streamingTextRef.current + chunkTextToAppend + `\n\n🚨 [LỖI HỆ THỐNG]: ${errorDetail}`;
                  const errorId = generateId();
                  setMessages((prev) => [
                    ...prev,
                    { id: errorId, role: 'assistant', content: errorContent }
                  ]);
                  
                  setStreamingText('');
                  streamingTextRef.current = '';
                  chunkTextToAppend = ''; // Xóa buffer tạm
                  
                  // Ép UI tắt trạng thái Thinking & Tắt cờ Race Condition
                  setIsThinking(false);
                  setIsStreaming(false);
                  isStreamingRef.current = false;
                  
                  // Bóp chết luồng treo (Kill Switch)
                  if (abortControllerRef.current) {
                      abortControllerRef.current.abort();
                  }
                  
                  // Thay lệnh continue; bằng lệnh break; để văng ra khỏi vòng lặp đọc stream
                  break; 
              }

              // Sử dụng Optional Chaining an toàn để lấy chuỗi Stream
              const chunk = data?.choices?.[0]?.delta?.content || data?.content || data?.text || '';
              if (chunk) {
                  chunkTextToAppend += chunk;
              }
            } catch (parseError) {
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
               const finalId = generateId();
               setMessages((prev) => [
                 ...prev,
                 { id: finalId, role: 'assistant', content: finalContentToSave }
               ]);
           }
           
           setStreamingText('');
           streamingTextRef.current = '';
           
           break;
        }
      }
    } catch (error: any) {
      // KIỂM SOÁT FALLBACK CHÍNH XÁC KHI NGẮT KẾT NỐI
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        if (isUserAbortedRef.current) {
           console.warn('[Luồng Thép AI] Người dùng đã chủ động dừng tạo phản hồi (Normal Behavior).');
        } else {
           console.error('[Luồng Thép AI] Luồng Stream bị đứt kết nối ngầm do lỗi mạng hoặc Server Rate Limit (DDoS)!');
           const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `msg-${Date.now()}`;
           const errorMsg = streamingTextRef.current + '\n\n🚨 **[Hệ thống AI]**: Lỗi gián đoạn kết nối do mạng không ổn định hoặc quá tải băng thông. Vui lòng thử lại sau giây lát.';
           const errorId = generateId();
           setMessages((prev) => [
             ...prev,
             { id: errorId, role: 'assistant', content: errorMsg }
           ]);
           setStreamingText('');
           streamingTextRef.current = '';
        }
      } else {
        console.error('Stream processing error:', error);
        const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `msg-${Date.now()}`;
        if (streamingTextRef.current) {
           const fallbackContent = streamingTextRef.current + '\n\n[Mạng chập chờn, luồng AI bị ngắt quãng]';
           const fallbackId = generateId();
           setMessages((prev) => [
             ...prev,
             { id: fallbackId, role: 'assistant', content: fallbackContent }
           ]);
           setStreamingText('');
           streamingTextRef.current = '';
        } else {
           const newId = generateId();
           setMessages((prev) => [
             ...prev,
             { id: newId, role: 'assistant', content: 'Hệ thống AI đang gián đoạn kết nối. Vui lòng thử lại.' }
           ]);
        }
      }
      
      // [BỌC THÉP UI]: Dù rớt mạng hay văng lỗi lạ, bắt buộc phải nhả cờ UI để không bị treo nút Gửi
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
    sendMessage,
    isStreaming,
    isThinking,
    stopStream,
    setMessages
  };
}
