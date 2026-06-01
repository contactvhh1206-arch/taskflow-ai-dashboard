import React from 'react';
import { useAIChatStream } from '../hooks/useAIChatStream';
import { AIChatBox } from './AIChatBox';

export const AIChatContainer: React.FC = () => {
  // HOISTING: Hook is now lifted to a parent container that won't unmount when modal closes
  const { messages, isStreaming, sendMessage, stopStream } = useAIChatStream();

  return (
    <div className="w-full h-full">
      {/* AIChatBox is now a pure presentation component */}
      <AIChatBox 
        messages={messages}
        isStreaming={isStreaming}
        sendMessage={sendMessage}
        stopStream={stopStream}
      />
    </div>
  );
};
