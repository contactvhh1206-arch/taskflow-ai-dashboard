import React, { useState } from 'react';
import { fetchHistory, fetchAiSessions, saveAiSession, streamAIChat } from '../services/dataService.js';

export default function AIAdvisor(props) {
  const { user, tasks, externalQueryTrigger, onExternalQueryHandled, activeSessionId, onSessionUpdate, onSessionCreated } = props;
  const isFacilityMode = props.isFacilityMode !== undefined ? props.isFacilityMode : (user && !['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role));
  let facilityName = props.facilityName || (isFacilityMode ? (localStorage.getItem('facility_name') || user?.facilityName || user?.facility_id || '') : '');
  
  try {
     if (typeof facilityName === 'string' && facilityName.startsWith('[')) {
        const parsed = JSON.parse(facilityName);
        if (Array.isArray(parsed) && parsed.length > 0) {
           facilityName = parsed[0];
        }
     }
  } catch(e) {}
  
  const [query, setQuery] = useState('');
  const currentSessionIdRef = React.useRef(activeSessionId);
  const isInitialMount = React.useRef(true);

  const messagesEndRef = React.useRef(null);

  const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  React.useEffect(() => {
      scrollToBottom();
  }, [chatLog]);


  const getGreetingText = (userObj) => {
    const hour = new Date().getHours();
    let timeGreeting = 'Chào buổi sáng';
    if (hour >= 12 && hour < 18) timeGreeting = 'Chào buổi chiều';
    if (hour >= 18) timeGreeting = 'Chào buổi tối';

    if (!userObj) return `${timeGreeting}! Tôi là Trợ lý Cố vấn AI Cấp cao đây! Bạn cần tôi hỗ trợ thông tin gì ạ?`;

    let displayName = userObj?.name || userObj?.username;
    
    if (isFacilityMode) {
      const fName = facilityName || 'bạn';
      return `${timeGreeting}, ${displayName || 'Quản lý'}! Tôi là Cố vấn AI riêng của cơ sở ${fName}. Tôi có thể giúp bạn cung cấp góc nhìn tổng quan, tình hình doanh thu, nhật ký hoạt động, nhân viên nghỉ phép và đánh giá chuyên cần của cơ sở mình.\n\n⚠️ LƯU Ý VỀ TÀI NGUYÊN HỆ THỐNG:\nToàn bộ truy vấn đều tiêu tốn chi phí API. Hệ thống chỉ hỗ trợ giải quyết các vấn đề phục vụ công việc và thuộc đúng thẩm quyền của phòng ban/cơ sở hiện tại.\nCác yêu cầu ngoài luồng ko liên quan công việc hoặc cố tình truy xuất dữ liệu/doanh thu chéo giữa các cơ sở sẽ bị từ chối tự động. Mọi lịch sử truy vấn vi phạm quy định sẽ được lưu vết và báo cáo trực tiếp lên Ban Giám đốc để xử lý.`;
    }

    const isMarketing = userObj.role === 'DEPARTMENT_HEAD';
    const isBoss = userObj.role === 'SUPER_ADMIN' || userObj.role === 'VICE_PRESIDENT';
    
    if (!displayName) {
       if (isMarketing) displayName = 'Trưởng phòng Marketing';
       else if (isBoss) displayName = 'Sếp';
       else displayName = 'bạn';
    }

    if (isMarketing) return `${timeGreeting}, ${displayName}! Tôi là Trợ lý Cố vấn AI Cấp cao đây! Dữ liệu vận hành toàn chuỗi đã được đồng bộ. Anh/chị cần tôi trích xuất báo cáo doanh thu, kiểm tra lỗi thiết bị, hay theo dõi tiến độ công việc của cơ sở nào ạ?`;
    if (isBoss) return `${timeGreeting}, Sếp ${displayName}! Tôi là Trợ lý Cố vấn AI Cấp cao đây! Dữ liệu vận hành toàn chuỗi đã được đồng bộ. Sếp cần tôi hỗ trợ thông tin gì ạ?`.replace('Sếp Sếp', 'Sếp').replace('Sếp !', 'Sếp!');
    return `${timeGreeting}, ${displayName}! Tôi là Trợ lý Cố vấn AI Cấp cao đây! Dữ liệu vận hành toàn chuỗi đã được đồng bộ. Bạn cần tôi hỗ trợ thông tin gì ạ?`;
  };

  const defaultLog = user?.role === 'FACILITY_MANAGER' ? [{
    role: 'ai',
    content: "Chào bạn, tôi là Trợ lý AI nội bộ trực thuộc cơ sở. Chức năng của tôi là tối ưu hóa nghiệp vụ: phân tích doanh thu, báo cáo chuyên cần và hỗ trợ công việc tổng thể. Vui lòng nhập yêu cầu của bạn.\n\n⚠️ LƯU Ý HỆ THỐNG: Tài nguyên truy vấn (API) có giới hạn và được giám sát chặt chẽ. AI chỉ cấp quyền truy cập dữ liệu nội bộ của cơ sở bạn đang làm việc. Mọi hành vi cố tình dò hỏi dữ liệu chéo giữa các chi nhánh hoặc không phục vụ công việc sẽ bị từ chối, ghi log (lưu vết) và báo cáo tự động lên Ban Giám đốc."
  }] : [];

  const [chatLog, setChatLog] = useState(defaultLog);

  React.useEffect(() => {
    currentSessionIdRef.current = activeSessionId;
    if (activeSessionId) {
       const sessions = JSON.parse(localStorage.getItem('taskflow_ai_sessions') || '[]');
       const session = sessions.find(s => s.id === activeSessionId);
       if (session) {
         setChatLog(session.chatLog || []);
       }
    } else {
       setChatLog(defaultLog);
    }
  }, [activeSessionId, user?.role]);

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (chatLog.length === 0) return;
    if (chatLog.length === 1 && chatLog[0].role === 'ai' && user?.role === 'FACILITY_MANAGER') return;

    let sessions = JSON.parse(localStorage.getItem('taskflow_ai_sessions') || '[]');
    let currentId = currentSessionIdRef.current;
    
    if (!currentId) {
      currentId = 'session_' + Date.now();
      currentSessionIdRef.current = currentId;
      
      const title = chatLog.find(m => m.role === 'user')?.content?.substring(0, 30) || 'Phiên AI mới';
      sessions.unshift({
        id: currentId,
        userId: user?.username || user?.id,
        title: title,
        chatLog: chatLog,
        timestamp: Date.now()
      });
      if (onSessionCreated) onSessionCreated(currentId);
    } else {
      const idx = sessions.findIndex(s => s.id === currentId);
      if (idx !== -1) {
        sessions[idx].chatLog = chatLog;
        sessions[idx].timestamp = Date.now();
      } else {
        const title = chatLog.find(m => m.role === 'user')?.content?.substring(0, 30) || 'Phiên AI mới';
        sessions.unshift({
          id: currentId,
          userId: user?.username || user?.id,
          title: title,
          chatLog: chatLog,
          timestamp: Date.now()
        });
      }
    }
    
    localStorage.setItem('taskflow_ai_sessions', JSON.stringify(sessions));
    if (onSessionUpdate) {
      onSessionUpdate(sessions);
    }
    
    // Đồng bộ lên backend (Global Memory)
    try {
      const currentSessionData = sessions.find(s => s.id === currentId);
      if (currentSessionData) {
         const token = localStorage.getItem('taskflow_token');
         if (token) {
            saveAiSession({
               ...currentSessionData,
               facility: user?.facilityName || user?.facility_id || 'HQ'
            }, token, user?.role, user?.facility_id);
         }
      }
    } catch (e) {}
  }, [chatLog, user?.id, onSessionUpdate]);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const fileInputRef = React.useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      if (window.showToast) window.showToast('File vượt quá dung lượng 20MB', 'error');
      return;
    }
    
    const ext = file.name.split('.').pop().toLowerCase();
    const validExts = ['jpg', 'jpeg', 'png', 'pdf', 'xlsx', 'csv'];
    if (!validExts.includes(ext)) {
      if (window.showToast) window.showToast(`Định dạng .${ext.toUpperCase()} hiện chưa được hỗ trợ. Vui lòng sử dụng JPG, PNG, PDF, XLSX hoặc CSV.`, 'error');
      return;
    }

    if (ext === 'xlsx' || ext === 'csv') {
       const reader = new FileReader();
       reader.onload = (ev) => {
          try {
             const data = new Uint8Array(ev.target.result);
             const workbook = window.XLSX.read(data, {type: 'array'});
             let extractedText = '';
             workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                extractedText += `--- Sheet: ${sheetName} ---\n`;
                extractedText += window.XLSX.utils.sheet_to_csv(sheet).substring(0, 5000);
             });
             setAttachment({ name: file.name, type: file.type || ext, url: null, extractedText, isDoc: true });
          } catch (err) {
             if (window.showToast) window.showToast('Lỗi đọc file bảng tính: ' + err.message, 'error');
          }
       };
       reader.readAsArrayBuffer(file);
    } else {
       const reader = new FileReader();
       reader.onload = (ev) => {
           let base64Url = ev.target.result;
           let mimeType = file.type;
           if (!mimeType) {
             if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
             else if (ext === 'png') mimeType = 'image/png';
             else if (ext === 'pdf') mimeType = 'application/pdf';
           }
           
           const dataUrlRegex = /^data:([^;]*);base64,/;
           const match = base64Url.match(dataUrlRegex);
           if (match) {
             const currentMime = match[1];
             if (!currentMime || currentMime === 'application/octet-stream' || currentMime === '') {
                base64Url = base64Url.replace(dataUrlRegex, `data:${mimeType};base64,`);
             }
           }
           
         setAttachment({ name: file.name, type: mimeType, url: base64Url, isDoc: false });
       };
       reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleSpeechInput = () => {
    if (isRecording) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (window.showToast) window.showToast('Trình duyệt của bạn không hỗ trợ nhận diện giọng nói (Web Speech API).', 'error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setQuery(prev => prev ? prev + ' ' + transcript : transcript);
    };
    recognition.onerror = (event) => {
      if (window.showToast) window.showToast('Lỗi nhận diện giọng nói: ' + event.error, 'error');
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);
    
    recognition.start();
  };


  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (externalQueryTrigger) {
        handleAsk(externalQueryTrigger);
        if (onExternalQueryHandled) onExternalQueryHandled();
    }
  }, [externalQueryTrigger]);

  
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

  return (
    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col h-[75vh] animate-fade-in">
      <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-secondary/10 to-transparent flex items-center gap-3">
        <span className="material-symbols-outlined text-secondary text-3xl">robot_2</span>
        <div>
          <h2 className="font-bold text-lg dark:text-white">{isFacilityMode ? 'Cố vấn AI (Cơ sở)' : 'AI Advisor (Master AI)'}</h2>
          <p className="text-xs text-gray-500">{isFacilityMode ? 'Truy cập giới hạn: Dữ liệu nội bộ cơ sở' : 'Truy cập Global Data Stream: Company_Master_Logs'}</p>
        </div>
      </div>
      <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-4 custom-scrollbar relative">
        {chatLog.length === 0 && !isFacilityMode && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
            <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6 pointer-events-auto">
              <div onClick={() => handleAsk('Trích xuất báo cáo chi tiết tổng quan hoạt động của 6 cơ sở: DB41, DBACE, DBPQ, DB PA, DBPAV, DPPAK')} className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-8 rounded-3xl border border-blue-100 dark:border-blue-800/50 cursor-pointer hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1.5 transition-all duration-300 group relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
                <div className="relative w-16 h-16 bg-white dark:bg-[#2a2a2a] shadow-sm rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-blue-100/50 dark:border-gray-700">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>monitoring</span>
                </div>
                <h3 className="relative text-2xl font-bold text-gray-800 dark:text-white mb-3 leading-tight">Tổng quan 6 cơ sở</h3>
                <p className="relative text-base text-gray-600 dark:text-gray-400 leading-relaxed">Báo cáo chi tiết hoạt động của DB41, DBACE, DBPQ, DB PA, DBPAV, DPPAK.</p>
              </div>

              <div onClick={() => handleAsk('Cập nhật tiến độ phòng ban (Thiện, Cường, Tùng, Martin, Hoàng, Anh Phương)')} className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-8 rounded-3xl border border-purple-100 dark:border-purple-800/50 cursor-pointer hover:shadow-2xl hover:shadow-purple-500/10 hover:-translate-y-1.5 transition-all duration-300 group relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all"></div>
                <div className="relative w-16 h-16 bg-white dark:bg-[#2a2a2a] shadow-sm rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-purple-100/50 dark:border-gray-700">
                  <span className="material-symbols-outlined text-purple-600 dark:text-purple-400 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>engineering</span>
                </div>
                <h3 className="relative text-2xl font-bold text-gray-800 dark:text-white mb-3 leading-tight">Tiến độ phòng ban</h3>
                <p className="relative text-base text-gray-600 dark:text-gray-400 leading-relaxed">Cập nhật tiến độ phòng ban.</p>
              </div>
            </div>
          </div>
        )}
        {chatLog.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
            <div key={idx} className={`max-w-[80%] p-4 rounded-2xl text-sm ${msg.role === 'ai' ? 'bg-surface-container dark:bg-[#2a2a2a] dark:text-white rounded-tl-none border border-outline-variant dark:border-gray-700' : 'bg-primary text-white rounded-tr-none shadow-md'}`}>
              {msg.attachment && (
                 <div className="mb-3 max-w-[200px]">
                   {msg.attachment.type.startsWith('image/') ? (
                     <img src={msg.attachment.url} alt="attachment" className="w-full h-auto rounded-lg shadow-sm bg-white" />
                   ) : (
                     <div className="flex items-center gap-2 bg-black/20 p-2 rounded-lg text-xs">
                       <span className="material-symbols-outlined text-[16px]">description</span>
                       <span className="truncate">{msg.attachment.name}</span>
                     </div>
                   )}
                 </div>
              )}
              <p className="whitespace-pre-line leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-surface-container dark:bg-[#2a2a2a] p-4 rounded-2xl rounded-tl-none border border-outline-variant dark:border-gray-700 flex gap-2 items-center h-12">
              <div className="w-2 h-2 rounded-full bg-secondary animate-bounce"></div>
              <div className="w-2 h-2 rounded-full bg-secondary animate-bounce delay-100"></div>
              <div className="w-2 h-2 rounded-full bg-secondary animate-bounce delay-200"></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className={`p-4 ${chatLog.length > 0 ? 'border-t' : 'border-t-0 pt-0'} border-outline-variant dark:border-gray-800 bg-surface-container-lowest dark:bg-[#1a1a1a]`}>
        {chatLog.length === 0 && (
          <div className="mb-4 flex flex-wrap gap-2 justify-center">
             {(isFacilityMode ? [
               'Tình hình doanh thu hôm nay?',
               'Đánh giá chuyên cần nhân viên',
               'Ai đang nghỉ phép/không phép?',
               'Nhật ký hoạt động gần nhất',
               'Góc nhìn tổng quan cơ sở'
             ] : [
               'Báo cáo doanh thu hôm nay',
               'Cơ sở nào đang trễ task?',
               'Tình hình nhân sự',
               'Cơ sở nào chưa Check-in?',
               'Phân tích task trễ hạn',
               'Công việc đang làm của phòng ban',
               'Công việc cần làm của cơ sở',
               'Tình trạng và số lượng nghĩ ko phép, có phép',
               'Cơ sở nào đang cần hỗ trợ'
             ]).map((prompt, idx) => {
               const colors = [
                  'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50',
                  'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50',
                  'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/50',
                  'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50',
                  'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50',
                  'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50',
                  'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50',
                  'bg-pink-50 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800 hover:bg-pink-100 dark:hover:bg-pink-900/50',
                  'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50'
               ];
               const colorClass = colors[idx % colors.length];
               return (
                  <button key={idx} onClick={() => handleAsk(prompt)} className={`px-4 py-2 rounded-full font-medium text-sm border transition-colors shadow-sm hover:shadow ${colorClass}`}>
                     {prompt}
                  </button>
               );
             })}
          </div>
        )}
        {attachment && (
          <div className="mb-3 flex items-center gap-3 bg-surface-container dark:bg-[#252525] p-2 rounded-xl border border-outline-variant dark:border-gray-700 max-w-sm relative">
            {attachment.type.startsWith('image/') ? (
              <img src={attachment.url} alt="preview" className="h-12 w-12 object-cover rounded-lg border border-outline-variant bg-white" />
            ) : (
              <div className="h-12 w-12 flex items-center justify-center bg-surface-container-high dark:bg-[#2a2a2a] rounded-lg border border-outline-variant">
                <span className="material-symbols-outlined text-gray-500">description</span>
              </div>
            )}
            <span className="text-xs font-medium text-on-surface truncate dark:text-gray-200 flex-1">{attachment.name}</span>
            <button onClick={() => setAttachment(null)} className="text-gray-400 hover:text-error transition-colors p-1">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        )}
        <div className="flex gap-3 relative">
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/png, image/jpeg, .pdf, .doc, .docx, .xlsx, .csv" />
          <button 
            onClick={() => fileInputRef.current?.click()}
            title="Đính kèm file"
            className="absolute left-11 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full transition-all z-10 bg-transparent text-gray-400 hover:text-primary hover:bg-primary/10"
          >
            <span className="material-symbols-outlined text-[20px]">attach_file</span>
          </button>
          <button 
            onClick={handleSpeechInput} 
            title="Nhập liệu bằng giọng nói"
            className={`absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full transition-all z-10 ${isRecording ? 'bg-error/20 text-error animate-pulse' : 'bg-transparent text-gray-400 hover:text-primary hover:bg-primary/10'}`}
          >
            <span className="material-symbols-outlined text-[20px]">{isRecording ? 'mic' : 'mic_none'}</span>
            {isRecording && <span className="absolute inset-0 rounded-full border border-error animate-ping opacity-50"></span>}
          </button>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAsk()} placeholder="Ví dụ: So sánh hiệu suất trực ca của Cơ sở 1 và Cơ sở 2..." className="flex-1 min-w-0 bg-surface-container dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl pl-[5.5rem] pr-4 py-3 outline-none focus:ring-2 focus:ring-secondary text-sm dark:text-white transition-all shadow-inner relative" />
          <button onClick={handleAsk} disabled={(!query.trim() && !attachment) || isTyping} className="bg-secondary hover:bg-secondary/90 disabled:opacity-50 text-white px-4 md:px-6 shrink-0 rounded-xl shadow-md shadow-secondary/20 transition-all flex items-center justify-center gap-1 md:gap-2 font-bold">
            <span className="material-symbols-outlined">send</span> <span className="hidden sm:inline">Gửi</span>
          </button>
        </div>
      </div>
    </div>
  );
}


