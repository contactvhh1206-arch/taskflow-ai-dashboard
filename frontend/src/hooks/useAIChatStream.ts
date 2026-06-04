import { useState, useRef, useCallback, useEffect } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function useAIChatStream(options?: {
  onSessionCreated?: (sessionId: string) => void;
  onSessionUpdate?: (data: any) => void;
  onStreamComplete?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendMessage = useCallback(async (content: string, contextPayload: any) => {
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
      { id: generateId(), role: 'user', content, attachment: contextPayload?.attachment },
      { id: generateId(), role: 'assistant', content: '' } 
    ]);

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
        // Lỗi này giờ đây chỉ xảy ra nếu trình duyệt quá cũ không hỗ trợ URL API
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

      // KIẾN TRÚC LUỒNG UI STREAM THÉP - BẢN VÁ TỪ HUBDB 555
      let isFirstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        if (isFirstChunk) {
            setIsThinking(false);
            setIsStreaming(true);
            isFirstChunk = false;
        }

        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
        }

        // 1. DIỆT BẪY CRLF: Phân tách chunk chấp nhận cả \n\n và \r\n\r\n
        const lines = buffer.split(/\r?\n\r?\n/);
        buffer = lines.pop() || ''; // Giữ lại phần chưa nguyên vẹn

        let chunkTextToAppend = '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          if (trimmedLine.startsWith('data: ')) {
            const dataPayload = trimmedLine.replace(/^data:\s*/, '');
            if (dataPayload === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(dataPayload);
              
              // 2. CHỐNG RACE CONDITION TRẠNG THÁI (REACT STATE)
              // Chỉ kích hoạt callback nếu session thực sự thay đổi
              if (parsed.new_session_id && options?.onSessionCreated) {
                // Đẩy tác vụ này ra khỏi Microtask queue hiện tại để tránh chặn Render Stream
                setTimeout(() => options.onSessionCreated(parsed.new_session_id), 0);
              }
              
              const content = parsed.content || parsed.text || parsed.choices?.[0]?.delta?.content || "";
              if (content) {
                chunkTextToAppend += content;
              }
            } catch (parseError) {
              console.warn('[Luồng Thép] Bỏ qua chunk vỡ ngầm:', dataPayload);
            }
          }
        }

        if (chunkTextToAppend) {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            
            // 3. RÀO CHẮN OUT OF BOUNDS (-1 CRASH)
            if (lastIndex >= 0) {
              newMessages[lastIndex] = {
                ...newMessages[lastIndex],
                content: (newMessages[lastIndex].content || '') + chunkTextToAppend
              };
            }
            return newMessages;
          });
        }

        // 4. CHỐNG THẤT THOÁT BUFFER CUỐI CÙNG
        if (done) {
           if (buffer.trim().startsWith('data: ') && !buffer.includes('[DONE]')) {
              try {
                  const finalPayload = buffer.trim().replace(/^data:\s*/, '');
                  const finalParsed = JSON.parse(finalPayload);
                  const finalContent = finalParsed.content || finalParsed.text || finalParsed.choices?.[0]?.delta?.content || "";
                  if (finalContent) {
                      setMessages((prev) => {
                          const newMsgs = [...prev];
                          if (newMsgs.length > 0) {
                              newMsgs[newMsgs.length - 1].content += finalContent;
                          }
                          return newMsgs;
                      });
                  }
              } catch (e) {
                  // Buffer cuối là rác, bỏ qua an toàn
              }
           }
           }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn('Network request aborted to prevent Race Condition (Normal Behavior)');
      } else {
        console.error('Stream processing error:', error);
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIndex = newMessages.length - 1;
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content: newMessages[lastIndex].content + '\n[LỖI KẾT NỐI STREAM]'
          };
          return newMessages;
        });
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        isStreamingRef.current = false;
        setIsStreaming(false);
        setIsThinking(false);
        if (options?.onStreamComplete) options.onStreamComplete();
        abortControllerRef.current = null;
      }
    }
  }, []);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      isStreamingRef.current = false;
      setIsStreaming(false);
      setIsThinking(false);
    }
  }, []);

  return { messages, isStreaming, isThinking, sendMessage, stopStream, setMessages };
}
