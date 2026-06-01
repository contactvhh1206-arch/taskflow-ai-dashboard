import { useState, useRef, useCallback, useEffect } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function useAIChatStream() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
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
    setIsStreaming(true);

    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev, 
      { id: userMsgId, role: 'user', content },
      { id: assistantMsgId, role: 'assistant', content: '' } 
    ]);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, context: contextPayload }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        
        let chunkTextToAppend = '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          if (trimmedLine.startsWith('data: ')) {
            const dataPayload = trimmedLine.replace(/^data:\s*/, '');
            if (dataPayload === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(dataPayload);
              const contentDelta = parsed.choices?.[0]?.delta?.content;
              if (contentDelta) {
                chunkTextToAppend += contentDelta;
              }
            } catch (parseError) {
              console.warn('Silent fallback: JSON parse failed on SSE chunk:', dataPayload);
            }
          }
        }

        if (chunkTextToAppend) {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: newMessages[lastIndex].content + chunkTextToAppend
            };
            return newMessages;
          });
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
        abortControllerRef.current = null;
      }
    }
  }, []);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      isStreamingRef.current = false;
      setIsStreaming(false);
    }
  }, []);

  return { messages, isStreaming, sendMessage, stopStream, setMessages };
}
