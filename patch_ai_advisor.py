import re

with open('agent/rules/stitch_smart_ai_task_management_system/src/components/AIAdvisor.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Fix imports
text = text.replace(
    "import { fetchHistory, fetchAiSessions, saveAiSession } from '../services/dataService.js';",
    "import { fetchHistory, fetchAiSessions, saveAiSession, streamAIChat } from '../services/dataService.js';"
)

# 2. Add scroll logic
scroll_logic = """
  const messagesEndRef = React.useRef(null);

  const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  React.useEffect(() => {
      scrollToBottom();
  }, [chatLog]);
"""
# Insert after `const isInitialMount = React.useRef(true);`
text = text.replace(
    "const isInitialMount = React.useRef(true);",
    "const isInitialMount = React.useRef(true);\n" + scroll_logic
)

# 3. Replace handleAsk
new_handle_ask = """
  const handleAsk = async (overrideQuery) => {
    let actualQuery = query;
    if (typeof overrideQuery === 'string') {
        actualQuery = overrideQuery;
    } else if (overrideQuery && overrideQuery.preventDefault) {
        overrideQuery.preventDefault();
    }
    if (!actualQuery.trim() && !attachment) return;
    
    // Ghi nhận câu hỏi của user
    const userQuery = actualQuery.trim() || 'Vui lòng phân tích tệp đính kèm này.';
    setChatLog(prev => [...prev, { role: 'user', content: userQuery, attachment: attachment }]);
    setQuery('');
    setIsTyping(true);
    setAttachment(null);

    // Chặn nhanh các từ khóa vi phạm ở Frontend (Facility Mode)
    if (isFacilityMode) {
        const forbiddenKeywords = ['cơ sở khác', 'phòng ban', 'chuỗi', 'tất cả cơ sở', 'cơ sở 1', 'cơ sở 2', 'toàn hệ thống'];
        const isForbidden = forbiddenKeywords.some(kw => userQuery.toLowerCase().includes(kw));
        
        if (isForbidden) {
          const responseContent = `Xin lỗi, tôi là Cố vấn AI riêng của cơ sở ${facilityName || 'này'}. Tôi bị hạn chế quyền truy cập và KHÔNG ĐƯỢC PHÉP cung cấp thông tin của các cơ sở khác hay phòng ban khác. Yêu cầu truy cập trái phép này đã được ghi nhận và gửi về Ban Giám Đốc.`;
          try {
            const violations = JSON.parse(localStorage.getItem('taskflow_ai_violations') || '[]');
            violations.push({
              id: Date.now(),
              timestamp: new Date().toISOString(),
              userId: user?.username || user?.id,
              facility: facilityName,
              query: userQuery,
              status: 'Violation'
            });
            localStorage.setItem('taskflow_ai_violations', JSON.stringify(violations));
          } catch {}
          setChatLog(prev => [...prev, { role: 'ai', content: responseContent }]);
          setIsTyping(false);
          return;
        }
    }

    try {
      const token = localStorage.getItem('taskflow_token');
      const sessionId = currentSessionIdRef.current;
      
      // Tạo trước một tin nhắn AI trống trong State để hứng luồng Stream
      setChatLog(prev => [...prev, { role: 'ai', content: '' }]);

      // Đẩy việc xử lý AI cho Backend thông qua hàm streamAIChat
      await streamAIChat(
          userQuery,
          sessionId,
          token,
          (chunkText) => {
              // onChunk chuẩn kiến trúc React Immutability
              setChatLog(prev => {
                  const newLog = [...prev];
                  const lastIndex = newLog.length - 1;
                  const lastMsg = newLog[lastIndex];
                  
                  if (lastMsg && lastMsg.role === 'ai') {
                      // Tạo hẳn một Object mới, copy các thuộc tính cũ và cộng dồn content
                      newLog[lastIndex] = { 
                          ...lastMsg, 
                          content: lastMsg.content + chunkText 
                      };
                  }
                  return newLog;
              });
          },
          () => {
              // onDone
              setIsTyping(false);
          },
          (errorMsg) => {
              // onError
              console.error("Lỗi AI stream:", errorMsg);
              setChatLog(prev => {
                  const newLog = [...prev];
                  const lastIndex = newLog.length - 1;
                  const lastMsg = newLog[lastIndex];
                  if (lastMsg && lastMsg.role === 'ai') {
                      newLog[lastIndex] = {
                          ...lastMsg,
                          content: `Xin lỗi, đã xảy ra lỗi: ${errorMsg}`
                      };
                  }
                  return newLog;
              });
              setIsTyping(false);
          }
      );
    } catch (err) {
      console.error("AI Error:", err);
      setChatLog(prev => [...prev, { role: 'ai', content: `Xin lỗi, đã xảy ra lỗi khi kết nối (${err.message}).` }]);
      setIsTyping(false);
    }
  };
"""

# Replace the block from `const handleAsk = async (overrideQuery) => {` up to `};` before `return (`
text = re.sub(r"const handleAsk = async \(overrideQuery\) => \{.*?\n  \};\n", new_handle_ask, text, flags=re.DOTALL)

# 4. Add `<div ref={messagesEndRef} />` anchor
# Find the div that ends the chat messages container. It's before `</div>\n      <div className={`p-4 ${chatLog.length > 0 ? 'border-t' : 'border-t-0 pt-0'}`
text = text.replace(
    """        )}
      </div>
      <div className={`p-4 ${chatLog.length > 0 ? 'border-t' : 'border-t-0 pt-0'} border-outline-variant dark:border-gray-800 bg-surface-container-lowest dark:bg-[#1a1a1a]`}>""",
    """        )}
        <div ref={messagesEndRef} />
      </div>
      <div className={`p-4 ${chatLog.length > 0 ? 'border-t' : 'border-t-0 pt-0'} border-outline-variant dark:border-gray-800 bg-surface-container-lowest dark:bg-[#1a1a1a]`}>"""
)

with open('agent/rules/stitch_smart_ai_task_management_system/src/components/AIAdvisor.jsx', 'w', encoding='utf-8') as f:
    f.write(text)

print("AIAdvisor.jsx successfully patched!")
