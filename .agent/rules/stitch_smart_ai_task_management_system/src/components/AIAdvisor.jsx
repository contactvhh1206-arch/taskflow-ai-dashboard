import React, { useState } from 'react';
import { fetchHistory } from '../services/dataService.js';

export default function AIAdvisor() {
  const [query, setQuery] = useState('');
  const [chatLog, setChatLog] = useState([
    { role: 'ai', content: 'Chào sếp. Tôi là AI Advisor. Tôi có toàn quyền truy cập vào Global Data Stream (Company_Master_Logs). Sếp cần tôi phân tích dữ liệu điểm danh hay nhật ký vận hành của cơ sở nào?' }
  ]);
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


  const handleAsk = () => {
    if (!query.trim() && !attachment) return;
    const userQuery = query.trim() || 'Vui lòng phân tích tệp đính kèm này.';
    setChatLog(prev => [...prev, { role: 'user', content: userQuery, attachment: attachment }]);
    setQuery('');
    setIsTyping(true);
    setAttachment(null);

    setTimeout(() => {
      const allData = fetchHistory();
      const vectorDataArr = allData.map(d => d.aiVectorData).filter(Boolean);

      let responseContent = `Dựa trên dữ liệu hệ thống (Company_Master_Logs có ${allData.length} bản ghi): \n\n`;
      if (userQuery.toLowerCase().includes('so sánh') && userQuery.toLowerCase().includes('cơ sở 1') && userQuery.toLowerCase().includes('cơ sở 2')) {
        const cs1Logs = allData.filter(d => d.org_unit === 'Cơ sở 1');
        const cs2Logs = allData.filter(d => d.org_unit === 'Cơ sở 2');
        responseContent += `- Cơ sở 1: Có ${cs1Logs.length} bản ghi.\n- Cơ sở 2: Có ${cs2Logs.length} bản ghi.\n Nhìn chung, dựa vào dữ liệu RAG, AI có thể phân tích chi tiết hiệu suất của 2 cơ sở.`;
      } else {
        responseContent += 'Dữ liệu Vector AI trích xuất được:\n' + vectorDataArr.slice(0, 3).join('\n') + (vectorDataArr.length > 3 ? '\n...' : '');
      }

      setChatLog(prev => [...prev, { role: 'ai', content: responseContent }]);
      setIsTyping(false);
    }, 1500);
  };

  return (
    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col h-[75vh] animate-fade-in">
      <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-secondary/10 to-transparent flex items-center gap-3">
        <span className="material-symbols-outlined text-secondary text-3xl">robot_2</span>
        <div>
          <h2 className="font-bold text-lg dark:text-white">AI Advisor (Master AI)</h2>
          <p className="text-xs text-gray-500">Truy cập Global Data Stream: Company_Master_Logs</p>
        </div>
      </div>
      <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-4 custom-scrollbar">
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
      </div>
      <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-surface-container-lowest dark:bg-[#1a1a1a]">
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
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAsk()} placeholder="Ví dụ: So sánh hiệu suất trực ca của Cơ sở 1 và Cơ sở 2..." className="flex-1 bg-surface-container dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl pl-[5.5rem] pr-4 py-3 outline-none focus:ring-2 focus:ring-secondary text-sm dark:text-white transition-all shadow-inner relative" />
          <button onClick={handleAsk} disabled={(!query.trim() && !attachment) || isTyping} className="bg-secondary hover:bg-secondary/90 disabled:opacity-50 text-white px-6 rounded-xl shadow-md shadow-secondary/20 transition-all flex items-center justify-center gap-2 font-bold">
            <span className="material-symbols-outlined">send</span> Gửi
          </button>
        </div>
      </div>
    </div>
  );
}
