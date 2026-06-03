import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Custom Hook: Quản lý luồng Stream AI (SSE)
 * Cảnh báo: TUYỆT ĐỐI CẤM THAO TÁC DOM TRỰC TIẾP
 */
export function useAIStream(endpoint) {
    const [streamedResponse, setStreamedResponse] = useState('');
    const [isError, setIsError] = useState(false);

    const isStreamingRef = useRef(false);
    const abortControllerRef = useRef(null);

    const startStream = useCallback(async (promptPayload) => {
        if (isStreamingRef.current) {
            console.warn("BLOCKED: Luồng AI đang chảy, khóa chết các nỗ lực spam gửi request!");
            return;
        }

        isStreamingRef.current = true;
        setStreamedResponse('');
        setIsError(false);

        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}` 
                },
                body: JSON.stringify(promptPayload),
                signal: abortControllerRef.current.signal
            });

            if (!response.body) throw new Error("ReadableStream không được hỗ trợ.");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                setStreamedResponse(prev => prev + chunk);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log("Luồng Stream đã bị người dùng hủy kết nối (Abort) thành công.");
            } else {
                console.error("Lỗi AI Stream:", error);
                setIsError(true);
            }
        } finally {
            isStreamingRef.current = false;
            abortControllerRef.current = null;
        }
    }, [endpoint]);

    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                isStreamingRef.current = false;
                console.log("Component Unmounted: Đã chặt đứt luồng kết nối SSE AI.");
            }
        };
    }, []);

    const stopStream = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            isStreamingRef.current = false;
        }
    }, []);

    return { 
        streamedResponse, 
        isError, 
        startStream,
        stopStream
    };
}
