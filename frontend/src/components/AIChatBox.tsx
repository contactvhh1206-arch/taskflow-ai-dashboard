import React, { useState, useRef, useEffect, FormEvent, UIEvent } from 'react';
import { Message } from '../hooks/useAIChatStream';

export const AIChatBox: React.FC<{
  messages: Message[], 
  isStreaming: boolean, 
  sendMessage: (msg: string, ctx: any) => void, 
  stopStream: () => void 
}> = ({ messages, isStreaming, sendMessage, stopStream }) => {
  const [inputValue, setInputValue] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef<boolean>(false);

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    
    if (distanceToBottom > 150) {
      isUserScrolledUpRef.current = true;
    } else {
      isUserScrolledUpRef.current = false;
    }
  };

  useEffect(() => {
    if (!isUserScrolledUpRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: isStreaming ? 'auto' : 'smooth'
      });
    }
  }, [messages, isStreaming]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isStreaming) return;
    
    isUserScrolledUpRef.current = false;
    
    const contextPayload = { facilityId: '123', role: 'DEPARTMENT_HEAD' };
    sendMessage(inputValue, contextPayload);
    setInputValue('');
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto border border-gray-300 rounded-lg shadow-lg overflow-hidden">
      <div 
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 p-4 overflow-y-auto space-y-4 bg-gray-50"
      >
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`p-3 rounded-lg max-w-[85%] shadow-sm ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white self-end ml-auto rounded-br-none' 
                : 'bg-white text-gray-800 self-start border border-gray-200 rounded-bl-none'
            }`}
          >
            <span className="whitespace-pre-wrap leading-relaxed">{msg.content}</span>
          </div>
        ))}
        <div ref={messagesEndRef} className="h-px w-full" />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-300 bg-white flex gap-3">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Nhập yêu cầu cho AI..."
          className="flex-1 border border-gray-300 p-2.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button type="button" onClick={stopStream} className="bg-red-500 text-white font-medium px-5 py-2.5 rounded-md hover:bg-red-600 active:bg-red-700 transition-colors shadow-sm">
            Dừng
          </button>
        ) : (
          <button type="submit" disabled={!inputValue.trim()} className="bg-blue-600 text-white font-medium px-5 py-2.5 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm">
            Gửi
          </button>
        )}
      </form>
    </div>
  );
};
