import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import supabase from '../utils/supabaseClient';
import axiosClient from '../api/axiosClient';
import { fetchHistory, fetchAiSessions, saveAiSession, streamAIChat } from '../services/dataService.js';
import { useAIChatStream } from '../hooks/useAIChatStream';
import AITaskModal from './AITaskModal';
export default function AIAdvisor(props) {
  const { user, tasks, externalQueryTrigger, onExternalQueryHandled, activeSessionId, onSessionUpdate, onSessionCreated, onAITaskConfirm } = props;
  const isFacilityMode = props.isFacilityMode !== undefined ? props.isFacilityMode : (user && !['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role));
  
  const [showAITaskModal, setShowAITaskModal] = useState(false);
  const [aiTaskTranscript, setAiTaskTranscript] = useState('');
  
  let facilityName = props.facilityName || (isFacilityMode ? (localStorage.getItem('facility_name') || user?.facilityName || user?.facility_id || '') : '');
  
  try {
     if (typeof facilityName === 'string' && facilityName.startsWith('[')) {
        const parsed = JSON.parse(facilityName);
        if (Array.isArray(parsed) && parsed.length > 0) {
           facilityName = parsed[0];
        }
     }
  } catch(e) {}
  
  const inputRef = React.useRef(null);
  const abortControllerRef = React.useRef(null);
  const currentSessionIdRef = React.useRef(activeSessionId);
  const isInitialMount = React.useRef(true);

  const messagesEndRef = React.useRef(null);

  // Auto Scroll: Cuộn xuống cuối mỗi khi chatLog thay đổi
  const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };




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

  const defaultLog = React.useMemo(() => {
    return user?.role === 'FACILITY_MANAGER' ? [{
      role: 'ai',
      content: "Chào bạn, tôi là Trợ lý AI nội bộ trực thuộc cơ sở. Chức năng của tôi là tối ưu hóa nghiệp vụ: phân tích doanh thu, báo cáo chuyên cần và hỗ trợ công việc tổng thể. Vui lòng nhập yêu cầu của bạn.\n\n⚠️ LƯU Ý HỆ THỐNG: Tài nguyên truy vấn (API) có giới hạn và được giám sát chặt chẽ. AI chỉ cấp quyền truy cập dữ liệu nội bộ của cơ sở bạn đang làm việc. Mọi hành vi cố tình dò hỏi dữ liệu chéo giữa các chi nhánh hoặc không phục vụ công việc sẽ bị từ chối, ghi log (lưu vết) và báo cáo tự động lên Ban Giám đốc."
    }] : [];
  }, [user?.role]);

  const handleStreamComplete = () => {
    isGeneratingRef.current = false; // [BỌC THÉP UI]: Mở khóa ngay khi luồng AI kết thúc (Thành công, Lỗi mạng, Lỗi Server)
    setTimeout(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, 0);
  };

  const { messages, streamError, isStreaming, isThinking, sendMessage, stopStream, setMessages, setStreamError } = useAIChatStream({
    onSessionCreated: (newSessionId) => {
      isSessionCreatedByMeRef.current = true;
      if (props.onSessionCreated) props.onSessionCreated(newSessionId);
      fetchAiSessions().then(res => {
          if (res.success && props.onSessionUpdate) {
              props.onSessionUpdate(res.data);
          }
      }).catch(err => console.error("Lỗi fetch sidebar:", err));
    },
    onStreamComplete: handleStreamComplete
  });

  const chatLog = defaultLog.length > 0 ? [...defaultLog, ...messages] : messages;
  const lastMsg = messages[messages.length - 1];
  const isTyping = isStreaming && lastMsg?.role === 'assistant' && !lastMsg?.content;

  const isRecording = useState(false)[0]; // Removed unused setter to fix potential lints, or kept as is
  const [attachment, setAttachment] = useState(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const fileInputRef = React.useRef(null);
  const isSessionCreatedByMeRef = React.useRef(false);
  const isFetchingHistory = React.useRef(false);
  const isStreamingRef = React.useRef(isStreaming);
  const isTypingRef = React.useRef(isTyping);
  const isGeneratingRef = React.useRef(false); // [BỌC THÉP UI]: Biến đồng bộ khóa ngàm chống Spam Click

  React.useEffect(() => {
     isStreamingRef.current = isStreaming;
     isTypingRef.current = isTyping;
  }, [isStreaming, isTyping]);

  React.useEffect(() => {
      if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
  }, [messages]);

  // [FIX RACE CONDITION]: Sử dụng state nội bộ để track chính xác sự chuyển đổi Session
  const [internalSessionId, setInternalSessionId] = React.useState(activeSessionId);

  // Khối 1: Lắng nghe sự thay đổi của Prop và quyết định có chém luồng hay không
  React.useEffect(() => {
    if (activeSessionId !== internalSessionId) {
        const wasCreatedHere = isSessionCreatedByMeRef.current;
        isSessionCreatedByMeRef.current = false; // Luôn nhả cờ an toàn

        // Chỉ ngắt luồng và xóa UI nếu hành động đổi Session KHÔNG xuất phát từ chính Component này
        if (!wasCreatedHere) {
            if (isStreamingRef.current || isTypingRef.current) {
                 stopStream();
            }
            setMessages([]);
        }
        
        currentSessionIdRef.current = activeSessionId; // Đồng bộ Ref cũ phòng hờ các logic khác còn dùng
        setInternalSessionId(activeSessionId);
    }
  }, [activeSessionId, internalSessionId, stopStream, setMessages]);

  // Khối 2: Luồng tải lịch sử giờ chỉ phụ thuộc vào internalSessionId đã được sàng lọc
  React.useEffect(() => {
    if (!internalSessionId) return; 
    if (isGeneratingRef.current) return; // FIX TẠI ĐÂY: Tránh đè bong bóng khi AI đang xử lý (thinking/streaming)
    
    const abortController = new AbortController();
    
    const loadHistory = async () => {
        isFetchingHistory.current = true;
        try {
            const data = await axiosClient.get(`/api/ai/chat-sessions/${internalSessionId}/messages`, {
                signal: abortController.signal
            });
            
            if (data.success && data.data) {
                setMessages(data.data.length > 0 ? data.data.map(m => ({ id: m.id || Math.random().toString(), role: m.role, content: m.content })) : []);
            } else if (Array.isArray(data)) {
                setMessages(data.length > 0 ? data.map(m => ({ id: m.id || Math.random().toString(), role: m.role, content: m.content })) : []);
            } else {
                setMessages([]);
            }
        } catch (err) {
            if (err.name === 'CanceledError' || err.name === 'AbortError') {
                console.log('Đã bóp cổ Request tải lịch sử của phiên:', internalSessionId);
                return; 
            }
            console.error("Lỗi tải lịch sử chat:", err);
            if (err?.response?.status === 403 || err?.response?.status === 404) {
                if (props.onSessionCreated) props.onSessionCreated(null);
                setMessages([]);
            }
        } finally {
            isFetchingHistory.current = false;
        }
    };
    
    loadHistory();

    return () => {
        abortController.abort();
    };
  }, [internalSessionId]);



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
             let sheetCount = 0;

             for (let sheetName of workbook.SheetNames) {
                if (sheetCount >= 2) break; 
                const sheet = workbook.Sheets[sheetName];
                
                const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
                
                // [CHỐT CHẶN FATAL ERROR]: Bỏ qua ngay lập tức nếu User up Sheet rỗng, bảo vệ engine
                if (!aoa || aoa.length === 0) continue;
                
                const slicedArray = aoa.slice(0, 50);
                const miniSheet = window.XLSX.utils.aoa_to_sheet(slicedArray);
                
                extractedText += `--- Sheet: ${sheetName} ---\n`;
                extractedText += window.XLSX.utils.sheet_to_csv(miniSheet);
                sheetCount++;
             }

             if (workbook.SheetNames.length > 2) {
                 extractedText += `\n... (Đã lược bớt các sheet còn lại để tối ưu bộ nhớ API)`;
             }

             setAttachment({ name: file.name, type: file.type || ext, url: null, extractedText, file: file, isDoc: true });
          } catch (err) {
             console.error('Lỗi đọc file bảng tính:', err.message);
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
           
         setAttachment({ name: file.name, type: mimeType, url: base64Url, file: file, isDoc: false });
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
      if (inputRef.current) {
          inputRef.current.value = inputRef.current.value ? inputRef.current.value + ' ' + transcript : transcript;
      }
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
    // KHÓA CỨNG BẰNG REF (Synchronous Check - Chống Spam Click triệt để)
    if (isGeneratingRef.current) {
        console.warn("Chặn đúp request: AI đang xử lý.");
        return;
    }

    isSessionCreatedByMeRef.current = true; 

    if (isStreaming || isThinking) {
        isSessionCreatedByMeRef.current = false;
        return;
    }

    let actualQuery = '';
    if (typeof overrideQuery === 'string') {
        actualQuery = overrideQuery;
    } else {
        if (overrideQuery && overrideQuery.preventDefault) {
            overrideQuery.preventDefault();
        }
        if (inputRef.current) {
            actualQuery = inputRef.current.value.trim();
        }
    }

    if (!actualQuery && !attachment) {
        isSessionCreatedByMeRef.current = false;
        return;
    }
    
    // Kéo cầu dao khóa UI ngay lập tức trước khi gọi hàm
    isGeneratingRef.current = true;

    const userQuery = actualQuery || 'Vui lòng phân tích tệp đính kèm này.';
    
    if (inputRef.current) {
        inputRef.current.value = '';
    }
    
    let currentAttachment = attachment;
    setAttachment(null);
    
    if (currentAttachment && currentAttachment.file) {
        setIsUploadingFile(true);
        try {
            const file = currentAttachment.file;
            const fileName = `chat_${Date.now()}_${Math.random().toString(36).substring(7)}_${file.name}`;
            const { error } = await supabase.storage.from('attachments').upload(fileName, file, {
                contentType: file.type || 'application/octet-stream'
            });
            if (error) throw error;
            const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(fileName);
            
            // Cập nhật lại attachment với publicUrl từ Supabase và xóa base64 cũ để tiết kiệm băng thông
            currentAttachment = {
                ...currentAttachment,
                url: publicUrl,
                file: null
            };
        } catch (err) {
            console.error("Lỗi upload đính kèm chat:", err);
            if (window.showToast) window.showToast('Lỗi tải lên đính kèm: ' + err.message, 'error');
            isGeneratingRef.current = false;
            setIsUploadingFile(false);
            return;
        }
        setIsUploadingFile(false);
    }

    let sessionId = props.activeSessionId || null;
    sendMessage(userQuery, { sessionId: sessionId, attachment: currentAttachment });
    isSessionCreatedByMeRef.current = false;
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
              <div onClick={() => handleAsk('Hãy đánh giá tổng quan tình hình của toàn bộ 6 cơ sở tính từ đầu tháng đến thời điểm hiện tại. Phân tích chéo dữ liệu Doanh thu, Vận hành và Tiến độ công việc trong tháng này để tìm ra điểm nóng hoặc rủi ro tiềm ẩn. LƯU Ý: Chỉ truy xuất và phân tích dữ liệu của tháng hiện tại, bỏ qua dữ liệu tháng trước. Đề xuất cho tôi hướng xử lý ngay lập tức!')} className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-8 rounded-3xl border border-blue-100 dark:border-blue-800/50 cursor-pointer hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1.5 transition-all duration-300 group relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
                <div className="relative w-16 h-16 bg-white dark:bg-[#2a2a2a] shadow-sm rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-blue-100/50 dark:border-gray-700">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>monitoring</span>
                </div>
                <h3 className="relative text-2xl font-bold text-gray-800 dark:text-white mb-3 leading-tight">Tổng quan 6 cơ sở</h3>
                <p className="relative text-base text-gray-600 dark:text-gray-400 leading-relaxed">Đánh giá toàn diện hoạt động của các cơ sở, nhận diện rủi ro chéo qua Doanh thu - Vận hành - Task.</p>
              </div>

              <div onClick={() => handleAsk('Hãy đánh giá tổng quan hiệu suất và tiến độ công việc của toàn bộ các phòng ban (Marketing, Tài chính, Kỹ thuật, Nhân sự, BGD) tính từ đầu tháng đến nay. Có phòng ban nào đang bị trễ task hoặc có điểm nóng cần xử lý gấp trong tháng hiện tại không? LƯU Ý: Chỉ truy xuất dữ liệu trong giới hạn từ đầu tháng đến thời điểm hiện tại. Đề xuất giải pháp!')} className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-8 rounded-3xl border border-purple-100 dark:border-purple-800/50 cursor-pointer hover:shadow-2xl hover:shadow-purple-500/10 hover:-translate-y-1.5 transition-all duration-300 group relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all"></div>
                <div className="relative w-16 h-16 bg-white dark:bg-[#2a2a2a] shadow-sm rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-purple-100/50 dark:border-gray-700">
                  <span className="material-symbols-outlined text-purple-600 dark:text-purple-400 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>engineering</span>
                </div>
                <h3 className="relative text-2xl font-bold text-gray-800 dark:text-white mb-3 leading-tight">Tổng quan Phòng ban</h3>
                <p className="relative text-base text-gray-600 dark:text-gray-400 leading-relaxed">Rà soát tiến độ công việc, đo lường hiệu suất và các điểm nghẽn của tất cả phòng ban.</p>
              </div>
            </div>
          </div>
        )}
        {chatLog.map((msg, idx) => (
          <div key={idx} className={`flex w-full mb-4 ${msg?.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
              msg?.role === 'user' 
                ? 'bg-white text-gray-900 rounded-br-none shadow-md border border-gray-200 dark:bg-gray-100 dark:text-gray-900' 
                : (msg?.isError ? 'bg-red-50 text-red-600 border border-red-300 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-400 rounded-bl-none' : 'bg-gray-100 text-gray-800 rounded-bl-none border border-gray-200 shadow-sm dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700')
            }`}>
              {msg?.attachment && (
                 <div className="mb-3 max-w-[200px]">
                   {msg?.attachment?.type?.startsWith('image/') ? (
                     <img src={msg?.attachment?.url} alt="attachment" className="w-full h-auto rounded-lg shadow-sm bg-white" />
                   ) : (
                     <div className="flex items-center gap-2 bg-black/20 p-2 rounded-lg text-xs">
                       <span className="material-symbols-outlined text-[16px]">description</span>
                       <span className="truncate">{msg?.attachment?.name || "File đính kèm"}</span>
                     </div>
                   )}
                 </div>
              )}
              <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose dark:prose-invert max-w-none text-sm">{msg?.content ?? "⚠️ Lỗi hiển thị tin nhắn"}</ReactMarkdown>
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-surface-container dark:bg-[#2a2a2a] p-4 rounded-2xl rounded-tl-none border border-outline-variant dark:border-gray-700 flex gap-2 items-center text-gray-500 text-sm">
              <span className="material-symbols-outlined text-sm animate-pulse text-secondary">memory</span> 
              Cố vấn đang phân tích dữ liệu hệ thống...
            </div>
          </div>
        )}
        {isTyping && !isThinking && (
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
      {streamError && (
        <div className="px-4 py-2 w-full animate-fade-in bg-red-50 border-t border-red-200 dark:bg-red-900/20 dark:border-red-800/50">
          <div className="text-red-600 dark:text-red-400 text-sm shadow-sm flex items-center gap-3">
            <span className="material-symbols-outlined">error</span>
            <span className="font-medium whitespace-pre-wrap flex-1">{streamError}</span>
            <button onClick={() => setStreamError && setStreamError(null)} className="ml-2 text-red-500 hover:text-red-700 bg-red-100 dark:bg-red-900/40 rounded-full w-6 h-6 flex items-center justify-center transition-colors">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}
      <div className={`p-4 ${chatLog.length > 0 ? 'border-t' : 'border-t-0 pt-0'} border-outline-variant dark:border-gray-800 bg-surface-container-lowest dark:bg-[#1a1a1a]`}>

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
          <input type="text" ref={inputRef} disabled={isStreaming || isThinking} onKeyDown={(e) => { if (e.key === 'Enter' && !(isStreaming || isThinking)) { e.preventDefault(); handleAsk(e); } }} placeholder="Ví dụ: So sánh hiệu suất trực ca của Cơ sở 1 và Cơ sở 2..." className="flex-1 min-w-0 bg-surface-container dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl pl-[5.5rem] pr-4 py-3 outline-none focus:ring-2 focus:ring-secondary text-sm dark:text-white transition-all shadow-inner relative" />
          
          {isStreaming ? (
             <button onClick={() => {
                 stopStream();
             }} className="bg-red-500 hover:bg-red-600 text-white px-4 md:px-6 shrink-0 rounded-xl shadow-md shadow-red-500/20 transition-all flex items-center justify-center gap-1 md:gap-2 font-bold">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span> <span className="hidden sm:inline">Dừng</span>
             </button>
          ) : (
             <>
               <button onClick={handleAsk} disabled={isStreaming || isThinking || isUploadingFile} className="bg-secondary hover:bg-secondary/90 disabled:opacity-50 text-white px-4 md:px-6 shrink-0 rounded-xl shadow-md shadow-secondary/20 transition-all flex items-center justify-center gap-1 md:gap-2 font-bold">
                 {isStreaming || isThinking || isUploadingFile ? <span className="material-symbols-outlined animate-spin text-[20px]">sync</span> : <span className="material-symbols-outlined text-[20px]">send</span>}
                 <span className="hidden md:inline">{isUploadingFile ? 'Đang tải file...' : 'Gửi'}</span>
               </button>
               {user && ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role) && (
                 <button 
                    onClick={() => {
                      setAiTaskTranscript('');
                      setShowAITaskModal(true);
                    }}
                    title="Trích xuất & Giao việc bằng AI"
                    className="bg-amber-500 hover:bg-amber-600 text-white px-3 shrink-0 rounded-xl shadow-md shadow-amber-500/20 transition-all flex items-center justify-center font-bold"
                  >
                    <span className="material-symbols-outlined">bolt</span>
                 </button>
               )}
             </>
          )}
        </div>
      </div>
      
      {showAITaskModal && (
        <AITaskModal 
          onClose={() => setShowAITaskModal(false)} 
          onConfirm={(tasks) => {
            if (onAITaskConfirm) onAITaskConfirm(tasks);
            setShowAITaskModal(false);
          }} 
          user={user} 
          initialText={aiTaskTranscript}
        />
      )}
    </div>
  );
}


