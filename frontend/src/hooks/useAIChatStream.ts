import { useState, useRef, useCallback, useEffect } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachment?: any;
}

export function useAIChatStream(options?: {
  sessionId?: string | null;
  initialMessages?: Message[];
  onSessionCreated?: (sessionId: string) => void;
  onSessionUpdate?: (data: any) => void;
  onStreamComplete?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  
  const isStreamingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sessionIdRef = useRef<string | null>(options?.sessionId || null);

  useEffect(() => {
    if (options?.sessionId) {
      sessionIdRef.current = options.sessionId;
    }
  }, [options?.sessionId]);

  useEffect(() => {
    if (options?.initialMessages) {
      setMessages((prev) => {
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
    setStreamError(null);

    const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random()}`;

    // HYBRID FIX: Thêm ngay bong bóng assistant rỗng để chạy chữ
    setMessages((prev) => [
      ...prev, 
      { id: generateId(), role: 'user', content, attachment: contextPayload?.attachment },
      { id: generateId(), role: 'assistant', content: '' } 
    ]);

    try {
      let chatEndpoint = '';
      try {
        let rawBase = import.meta.env.VITE_API_BASE_URL?.replace(/^["']|["']$/g, '').trim();
        if (rawBase && !rawBase.startsWith('http')) {
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

        const lines = buffer.split(/\r?\n\r?\n/);
        buffer = lines.pop() || ''; 

        let chunkTextToAppend = '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          if (trimmedLine.startsWith('data: ')) {
            const dataPayload = trimmedLine.replace(/^data:\s*/, '');
            if (dataPayload === '[DONE]') continue;
            
            if (dataPayload === '[DONE_WITH_ERROR]') {
                setStreamError("Sự cố hệ thống AI nội bộ (Error 500). Vui lòng liên hệ Admin.");
                throw new Error('SERVER_INTERNAL_ERROR'); 
            }
            
            try {
              const data = JSON.parse(dataPayload);
              
              if (data.sessionId) {
                  sessionIdRef.current = data.sessionId;
                  if (options?.onSessionCreated) {
                      setTimeout(() => options.onSessionCreated!(data.sessionId), 0);
                  }
                  continue; 
              }
              
              if (data.error) {
                  const errorDetail = typeof data.error === 'string' ? data.error : (data.error?.message || data.error?.type || "Lỗi Hệ thống AI");
                  setStreamError(`[Lỗi Hệ Thống]: ${errorDetail}`);
                  setIsThinking(false);
                  setIsStreaming(false);
                  isStreamingRef.current = false;
                  throw new Error('API_STREAM_ERROR');
              }

              const contentStr = data?.choices?.[0]?.delta?.content || data?.content || data?.text || '';
              if (contentStr) {
                  chunkTextToAppend += contentStr;
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
            if (lastIndex >= 0) {
              newMessages[lastIndex] = {
                ...newMessages[lastIndex],
                content: (newMessages[lastIndex].content || '') + chunkTextToAppend
              };
            }
            return newMessages;
          });
        }

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
              } catch (e) {}
           }
           break;
        }
      }
    } catch (error: any) {
      if (error.message === 'SERVER_INTERNAL_ERROR') {
          if (!streamError) setStreamError("Sự cố hệ thống AI nội bộ (Error 500). Vui lòng liên hệ Admin.");
      } else if (error.message === 'API_STREAM_ERROR') {
          // Lỗi đã được setStreamError
      } else if (error.name === 'AbortError' || error.name === 'CanceledError' || error.message?.includes('429') || error.message?.includes('Failed to fetch')) {
         setStreamError('Lỗi gián đoạn kết nối do mạng không ổn định hoặc quá tải băng thông. Vui lòng thử lại sau giây lát.');
         setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            if (lastIndex >= 0) {
                newMessages[lastIndex] = {
                ...newMessages[lastIndex],
                content: newMessages[lastIndex].content + '\n\n**[LỖI KẾT NỐI STREAM]**'
                };
            }
            return newMessages;
         });
      } else {
        setStreamError('Mạng chập chờn, luồng AI bị ngắt quãng');
      }
      
      setIsThinking(false);
      setIsStreaming(false);
      isStreamingRef.current = false;
      
    } finally {
      if (abortControllerRef.current === abortController) {
        isStreamingRef.current = false;
        setIsStreaming(false);
        setIsThinking(false);
        if (options?.onStreamComplete) options.onStreamComplete();
        abortControllerRef.current = null;
      }
    }
  }, [options]);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      isStreamingRef.current = false;
      setIsStreaming(false);
      setIsThinking(false);
    }
  }, []);

  return {
    messages,
    streamError,
    sendMessage,
    isStreaming,
    isThinking,
    stopStream,
    setMessages,
    setStreamError
  };
}
