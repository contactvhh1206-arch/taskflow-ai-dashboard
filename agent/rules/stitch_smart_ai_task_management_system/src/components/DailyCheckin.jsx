import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../App.jsx';
import { saveData, fetchHistory } from '../services/dataService.js';

export default function DailyCheckin({ onCheckinSuccess, showToast }) {
  const { user } = useContext(AuthContext);
  const today = new Date().toLocaleDateString('vi-VN');
  
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedTime, setSubmittedTime] = useState(null);
  const [selectedShift, setSelectedShift] = useState('Ca 1');
  const [checkins, setCheckins] = useState([]);
  
  const [activeTab, setActiveTab] = useState('checkin');

  
  const [logs, setLogs] = useState([]);
  const [logContent, setLogContent] = useState('');
  const [logImage, setLogImage] = useState(null);
  const [logAudio, setLogAudio] = useState(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);
  const timerRef = React.useRef(null);

  const [formData, setFormData] = useState({
    shift: 'Ca 1',
    hr_letan: { status: null, type: null, note: '' },
    hr_baove: { status: null, type: null, note: '' },
    hr_clocker: { status: null, type: null, note: '' },
    hr_ktv: { status: null, type: null, note: '' },
    manual_auth: 0,
    manual_unauth: 0,
    eq_camera: null,
    eq_maytinh: null,
    eq_den: null,
    eq_maylanh: null,
    eq_other: '',
    cleaning_done: false
  });
  
  const [logFilterDate, setLogFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [logFilterSearch, setLogFilterSearch] = useState('');
  const [logFilterHasImage, setLogFilterHasImage] = useState(false);

  const [historyFilterDate, setHistoryFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [historyFilterSearch, setHistoryFilterSearch] = useState('');
  const [historyFilterHasImage, setHistoryFilterHasImage] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      const attendanceData = await fetchHistory({ entry_type: 'Attendance' });
      setCheckins(attendanceData.map(item => ({
        id: item.id,
        facility_id: item.org_unit,
        date: item.date,
        shift: item.content.shift,
        timestamp: item.displayTime,
        formData: item.content,
        aiVectorData: item.aiVectorData
      })));

      const logsData = await fetchHistory({ entry_type: 'Operation_Log' });
      setLogs(logsData.map(item => ({
        id: item.id,
        facility_id: item.org_unit,
        date: item.date,
        timestamp: item.displayTime,
        content: typeof item.content === 'object' ? '' : item.content,
        image: (item.attachments || []).find(a => typeof a === 'string' && a.startsWith('data:image')) || null,
        audio: (item.attachments || []).find(a => typeof a === 'string' && a.startsWith('data:audio')) || null,
        aiVectorData: item.aiVectorData
      })));
    };
    fetchAll();
  }, []);

  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const max_size = 1280;

          if (width > height) {
            if (width > max_size) {
              height *= max_size / width;
              width = max_size;
            }
          } else {
            if (height > max_size) {
              width *= max_size / height;
              height = max_size;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve(dataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 15000000) {
        if (showToast) showToast('File ảnh quá lớn (Tối đa 15MB)');
        return;
      }
      const compressedDataUrl = await compressImage(file);
      setLogImage(compressedDataUrl);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          setLogAudio(reader.result);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      if (showToast) showToast("Không thể truy cập Microphone. Vui lòng cấp quyền.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleAddLog = async () => {
    if (!logContent.trim() && !logImage && !logAudio) return;
    
    const now = new Date();
    const timestamp = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    
    let mediaStr = [];
    if (logImage) mediaStr.push('ẢNH');
    if (logAudio) mediaStr.push('GHI ÂM');

    const aiVectorData = `[${timestamp}] CƠ SỞ ${user.facility_id} | NHẬT KÝ: ${logContent.trim() || 'Không có nội dung'} ${mediaStr.length ? `| CÓ ĐÍNH KÈM ${mediaStr.join(', ')}` : ''}`;
    
    const attachments = [logImage, logAudio].filter(Boolean);

    const newRecord = await saveData({
      org_unit: user.facility_id,
      entry_type: 'Operation_Log',
      content: logContent.trim() || ' ',
      attachments: attachments,
      aiVectorData
    });
    
    if (newRecord) {
      const mappedLog = {
        id: newRecord.id,
        facility_id: newRecord.org_unit,
        date: newRecord.date,
        timestamp: newRecord.displayTime,
        content: typeof newRecord.content === 'object' ? '' : newRecord.content,
        image: attachments.find(a => typeof a === 'string' && a.startsWith('data:image')) || null,
        audio: attachments.find(a => typeof a === 'string' && a.startsWith('data:audio')) || null,
        aiVectorData: newRecord.aiVectorData
      };
      
      setLogs([mappedLog, ...logs]);
      setLogContent('');
      setLogImage(null);
      setLogAudio(null);
    }
  };

  useEffect(() => {
    const submitted = checkins.find(c => c.facility_id === user.facility_id && c.date === today && c.shift === selectedShift);
    if (submitted) {
      setFormData(submitted.formData);
      setIsSubmitted(true);
      setSubmittedTime(submitted.timestamp);
    } else {
      setFormData({
        shift: selectedShift,
        hr_letan: { status: null, type: null, note: '' },
        hr_baove: { status: null, type: null, note: '' },
        hr_clocker: { status: null, type: null, note: '' },
        hr_ktv: { status: null, type: null, note: '' },
        manual_auth: 0,
        manual_unauth: 0,
        manual_auth_note: '',
        manual_unauth_note: '',
        eq_camera: null,
        eq_maytinh: null,
        eq_den: null,
        eq_maylanh: null,
        eq_other: '',
        cleaning_done: false
      });
      setIsSubmitted(false);
      setSubmittedTime(null);
    }
  }, [selectedShift, checkins, user.facility_id, today]);

  const checkHR = (hr) => {
    if (!hr || !hr.status) return false;
    if (hr.status === 'thieu') {
      const noteStr = hr.note || '';
      if (!noteStr.trim()) return false;
    }
    return true;
  };

  const sumManual = (formData.manual_auth || 0) + (formData.manual_unauth || 0);

  const checkEq = (field) => {
    if (!formData[field]) return false;
    if (formData[field] === 'su_co') {
      if (!formData[field + '_note'] || !formData[field + '_note'].trim()) return false;
    }
    return true;
  };

  const isFormValid = 
    checkHR(formData.hr_letan) && checkHR(formData.hr_baove) && checkHR(formData.hr_clocker) && checkHR(formData.hr_ktv) &&
    checkEq('eq_camera') && checkEq('eq_maytinh') && checkEq('eq_den') && checkEq('eq_maylanh') &&
    formData.cleaning_done &&
    ((formData.manual_unauth > 0) ? (formData.manual_unauth_note && formData.manual_unauth_note.trim()) : true) &&
    ((formData.manual_auth > 0) ? (formData.manual_auth_note && formData.manual_auth_note.trim()) : true);



  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid || isSubmitted) return;

    setLoading(true);
    try {
      const now = new Date();
      const timestamp = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      
      const getNotes = () => {
        return ['hr_letan', 'hr_baove', 'hr_clocker', 'hr_ktv']
          .filter(k => formData[k].status === 'thieu')
          .map(k => `${k.replace('hr_', '').toUpperCase()}: ${formData[k].note}`)
          .join(' | ');
      };
      const getEqNotes = () => {
        return [
          {k: 'eq_camera', n: 'Camera'}, 
          {k: 'eq_maytinh', n: 'Máy tính'}, 
          {k: 'eq_den', n: 'Đèn'}, 
          {k: 'eq_maylanh', n: 'Máy lạnh'}
        ].filter(e => formData[e.k] === 'su_co')
         .map(e => `${e.n.toUpperCase()}: ${formData[e.k + '_note']}`)
         .join(' | ');
      };
      const currentSumManual = (formData.manual_auth || 0) + (formData.manual_unauth || 0);
      const eqNotesStr = getEqNotes();
      
      let leaveNotesArr = [];
      if (formData.manual_unauth > 0) leaveNotesArr.push(`KP: ${formData.manual_unauth_note || 'Không'}`);
      if (formData.manual_auth > 0) leaveNotesArr.push(`CP: ${formData.manual_auth_note || 'Không'}`);
      const leaveNotesStr = leaveNotesArr.length > 0 ? leaveNotesArr.join(', ') : '0';

      const aiVectorData = `[${timestamp}] CƠ SỞ ${user.facility_id} | CA ${selectedShift} | NGHỈ: ${currentSumManual} (${leaveNotesStr}) | HỖ TRỢ: ${getNotes() || 'Không có'} | SỰ CỐ: ${eqNotesStr || 'Không có'}`;

      const newRecord = await saveData({
        org_unit: user.facility_id,
        entry_type: 'Attendance',
        content: { ...formData, shift: selectedShift },
        attachments: [],
        aiVectorData
      });
      
      if (newRecord) {
        const newCheckin = {
          id: newRecord.id,
          facility_id: newRecord.org_unit,
          date: newRecord.date,
          shift: selectedShift,
          timestamp: newRecord.displayTime,
          formData,
          aiVectorData
        };
        
        const filtered = checkins.filter(c => !(c.facility_id === user.facility_id && c.date === today && c.shift === selectedShift));
        const newHistory = [...filtered, newCheckin];
        setCheckins(newHistory);
        
        setIsSubmitted(true);
        setSubmittedTime(timestamp);
        if (showToast) showToast('Lưu điểm danh thành công');
        if (onCheckinSuccess) onCheckinSuccess(newCheckin);
      }
    } finally {
      setLoading(false);
    }
  };

  const setVal = (field, val) => {
    setIsSubmitted(false);
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  const updateHR = (field, key, value) => {
    setIsSubmitted(false);
    setFormData(prev => ({
      ...prev,
      [field]: { ...prev[field], [key]: value }
    }));
  };

  const renderHRSegment = (label, field) => {
    const hr = formData[field];
    const noteStr = hr.note || '';
    const isError = hr.status === 'thieu' && !noteStr.trim();
    return (
      <div className={`p-4 bg-surface-container-low dark:bg-[#252525] rounded-xl border ${isError ? 'border-error/50 shadow-sm shadow-error/10' : 'border-outline-variant dark:border-gray-700 shadow-sm'} flex flex-col gap-3 transition-colors`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
          <div className="flex bg-surface-container-highest dark:bg-[#1a1a1a] rounded-lg p-1 gap-1">
            <button type="button" onClick={() => updateHR(field, 'status', 'du')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${hr.status === 'du' ? 'bg-success text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              Đã sẵn sàng
            </button>
            <button type="button" onClick={() => updateHR(field, 'status', 'thieu')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${hr.status === 'thieu' ? 'bg-error text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              Cần hỗ trợ
            </button>
          </div>
        </div>
        
        {hr.status === 'thieu' && (
          <textarea 
            placeholder="Nhập phương án điều phối (VD: Thiếu 1 Lễ tân, cần CS2 hỗ trợ)..." 
            value={noteStr} 
            onChange={(e) => updateHR(field, 'note', e.target.value)}
            className={`w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border ${!noteStr.trim() ? 'border-error' : 'border-gray-300 dark:border-gray-600'} rounded-lg text-xs outline-none focus:ring-1 focus:ring-primary dark:text-white transition-colors placeholder-gray-400 min-h-[60px] resize-y`}
          />
        )}
      </div>
    );
  };

  const renderSegment = (label, field, val1, label1, val2, label2) => {
    const isError = formData[field] === 'su_co' && (!formData[field + '_note'] || !formData[field + '_note'].trim());
    return (
      <div className={`p-4 bg-surface-container-low dark:bg-[#252525] rounded-xl border ${isError ? 'border-error/50 shadow-sm shadow-error/10' : 'border-outline-variant dark:border-gray-700 shadow-sm'} flex flex-col gap-3 transition-colors`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
          <div className="flex bg-surface-container-highest dark:bg-[#1a1a1a] rounded-lg p-1 gap-1">
            <button type="button" onClick={() => setVal(field, val1)} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${formData[field] === val1 ? 'bg-success text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {label1}
            </button>
            <button type="button" onClick={() => setVal(field, val2)} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${formData[field] === val2 ? 'bg-error text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {label2}
            </button>
          </div>
        </div>
        {formData[field] === 'su_co' && (
          <textarea 
            placeholder="Nhập mô tả sự cố (VD: Camera bị mờ)..." 
            value={formData[field + '_note'] || ''} 
            onChange={(e) => setVal(field + '_note', e.target.value)}
            className={`w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border ${!formData[field + '_note']?.trim() ? 'border-error' : 'border-gray-300 dark:border-gray-600'} rounded-lg text-xs outline-none focus:ring-1 focus:ring-primary dark:text-white transition-colors placeholder-gray-400 min-h-[50px] resize-y`}
          />
        )}
      </div>
    );
  };

  const ca1Status = checkins.find(c => c.facility_id === user.facility_id && c.date === today && c.shift === 'Ca 1');
  const caLoStatus = checkins.find(c => c.facility_id === user.facility_id && c.date === today && c.shift === 'Ca Lỡ');
  const ca2Status = checkins.find(c => c.facility_id === user.facility_id && c.date === today && c.shift === 'Ca 2');

  const countAuthAbsence = formData.manual_auth || 0;
  const countUnauthAbsence = formData.manual_unauth || 0;



  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 mt-6">
      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-surface-container-low dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 w-fit mx-auto shadow-sm">
        <button 
          onClick={() => setActiveTab('checkin')} 
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'checkin' ? 'bg-white dark:bg-[#2a2a2a] text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          <span className="material-symbols-outlined text-[20px]">fact_check</span>
          Điểm Danh Hàng Ngày
        </button>
        <button 
          onClick={() => setActiveTab('history')} 
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'history' ? 'bg-white dark:bg-[#2a2a2a] text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          <span className="material-symbols-outlined text-[20px]">history</span>
          Lịch Sử Báo Cáo các Ca làm việc
        </button>
        <button 
          onClick={() => setActiveTab('log_history')} 
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'log_history' ? 'bg-white dark:bg-[#2a2a2a] text-secondary shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          <span className="material-symbols-outlined text-[20px]">history_edu</span>
          Lịch Sử Nhật Ký
        </button>
      </div>

      {activeTab === 'checkin' && (
        <div className="flex flex-col gap-6 animate-fade-in">
          {/* Thẻ trạng thái báo cáo */}
      <div className="bg-white dark:bg-[#1e1e1e] p-5 rounded-2xl border border-outline-variant dark:border-gray-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 animate-fade-in">
        <div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">analytics</span> Trạng thái Báo cáo Hôm nay
          </h3>
          <p className="text-xs text-gray-500 mt-1">Cơ sở: <span className="font-medium text-gray-700 dark:text-gray-300">{user?.facility_id}</span> | Ngày: {today}</p>
        </div>
        <div className="flex gap-4 md:gap-6 flex-wrap">
          <div className="flex flex-col gap-1 text-sm md:border-l border-gray-200 dark:border-gray-700 md:pl-5">
            <span className="font-semibold dark:text-gray-200">Ca 1 (Sáng)</span>
            {ca1Status ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-xs text-success dark:text-green-400"><span className="w-2 h-2 rounded-full bg-success"></span> Đã báo cáo lúc {ca1Status.timestamp}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-xs text-error dark:text-red-400"><span className="w-2 h-2 rounded-full bg-error animate-pulse"></span> Chưa báo cáo</span>
            )}
          </div>
          <div className="flex flex-col gap-1 text-sm md:border-l border-gray-200 dark:border-gray-700 md:pl-5">
            <span className="font-semibold dark:text-gray-200">Ca Lỡ (Giữa ca)</span>
            {caLoStatus ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-xs text-success dark:text-green-400"><span className="w-2 h-2 rounded-full bg-success"></span> Đã báo cáo lúc {caLoStatus.timestamp}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-xs text-error dark:text-red-400"><span className="w-2 h-2 rounded-full bg-error animate-pulse"></span> Chưa báo cáo</span>
            )}
          </div>
          <div className="flex flex-col gap-1 text-sm md:border-l border-gray-200 dark:border-gray-700 md:pl-5">
            <span className="font-semibold dark:text-gray-200">Ca 2 (Chiều/Tối)</span>
            {ca2Status ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-xs text-success dark:text-green-400"><span className="w-2 h-2 rounded-full bg-success"></span> Đã báo cáo lúc {ca2Status.timestamp}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-xs text-error dark:text-red-400"><span className="w-2 h-2 rounded-full bg-error animate-pulse"></span> Chưa báo cáo</span>
            )}
          </div>
        </div>
      </div>


      {/* Nhật ký vận hành hôm nay */}
      <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl border border-outline-variant dark:border-gray-800 shadow-sm flex flex-col gap-5 animate-fade-in">
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">book</span> Nhật ký vận hành hôm nay
        </h3>
        
        <div className="flex flex-col gap-3">
          <textarea 
            placeholder="Nhập ghi chú nhanh, sự cố, hoặc hiện trạng..." 
            value={logContent} 
            onChange={(e) => setLogContent(e.target.value)}
            className="w-full px-4 py-3 bg-surface-container-lowest dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white min-h-[80px] resize-y"
          />
          {logImage && (
            <div className="relative w-max mt-2">
              <img src={logImage} alt="Preview" className="h-24 rounded-lg border border-gray-200 dark:border-gray-700 object-cover" />
              <button onClick={() => setLogImage(null)} className="absolute -top-2 -right-2 w-6 h-6 bg-error text-white rounded-full flex items-center justify-center hover:bg-error/90 shadow-sm z-10">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          )}
          {logAudio && (
            <div className="relative w-full max-w-sm mt-2">
              <audio controls src={logAudio} className="w-full h-10" />
              <button onClick={() => setLogAudio(null)} className="absolute -top-2 -right-2 w-6 h-6 bg-error text-white rounded-full flex items-center justify-center hover:bg-error/90 shadow-sm z-10">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl cursor-pointer transition-colors text-sm font-semibold">
                <span className="material-symbols-outlined text-[18px]">image</span> Đính kèm ảnh
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
              <label className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl cursor-pointer transition-colors text-sm font-semibold">
                <span className="material-symbols-outlined text-[18px]">photo_camera</span> Chụp hình
                <input type="file" accept="image/*" capture="environment" onChange={handleImageUpload} className="hidden" />
              </label>
              {isRecording ? (
                <button onClick={stopRecording} className="flex items-center gap-1.5 px-3 py-2 bg-error/10 hover:bg-error/20 text-error rounded-xl transition-colors text-sm font-semibold animate-pulse">
                  <span className="material-symbols-outlined text-[18px]">stop_circle</span> Đang thu... {formatTime(recordingTime)}
                </button>
              ) : (
                <button onClick={startRecording} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl transition-colors text-sm font-semibold">
                  <span className="material-symbols-outlined text-[18px]">mic</span> Ghi âm
                </button>
              )}
            </div>
            <button onClick={handleAddLog} disabled={!logContent.trim() && !logImage && !logAudio} className="bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-white px-6 py-2 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center gap-2 shrink-0">
              <span className="material-symbols-outlined text-[18px]">send</span> Ghi nhật ký
            </button>
          </div>
        </div>

        {/* Timeline */}
        {logs.filter(l => l.facility_id === user.facility_id && l.date === today).length > 0 && (
          <div className="flex flex-col gap-4 mt-2 border-t border-gray-100 dark:border-gray-800 pt-5">
            {logs.filter(l => l.facility_id === user.facility_id && l.date === today).map((log, i, arr) => (
              <div key={log.id} className="flex gap-4 items-start relative">
                {i !== arr.length - 1 && (
                  <div className="absolute left-2 top-8 bottom-[-20px] w-[2px] bg-gray-200 dark:bg-gray-700"></div>
                )}
                <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1 z-10 shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_#1e1e1e]"></div>
                <div className="flex flex-col gap-2 pb-2 w-full">
                  <span className="text-xs font-bold text-primary">{log.timestamp}</span>
                  <div className="bg-gray-50 dark:bg-[#252525] p-3.5 rounded-xl border border-gray-100 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 break-words">
                    {log.content}
                    {log.image && (
                      <div className="mt-3">
                        <img src={log.image} alt="Log Attachment" className="max-h-40 rounded-lg border border-gray-200 dark:border-gray-700 object-cover" />
                      </div>
                    )}
                    {log.audio && (
                      <div className="mt-3">
                        <audio controls src={log.audio} className="w-full max-w-sm h-10" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-[#1e1e1e] w-full rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col animate-fade-in">
        <div className="p-6 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-primary/10 to-transparent flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-on-surface dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-2xl">fact_check</span>
              Báo Cáo Đầu Ca (Check-in)
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Cơ sở: <span className="font-bold text-primary dark:text-blue-400">{user?.facility_id}</span></p>
          </div>
        </div>

      <form onSubmit={handleSubmit} className="flex-1 p-6 space-y-6">
        {/* Chọn Ca */}
        <div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-gray-400">schedule</span> Chọn Ca Làm Việc
          </h3>
          <div className="flex gap-4">
            <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedShift === 'Ca 1' ? 'border-primary bg-primary/5 text-primary dark:bg-primary/20' : 'border-outline-variant dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              <input type="radio" name="shift" value="Ca 1" checked={selectedShift === 'Ca 1'} onChange={(e) => setSelectedShift(e.target.value)} className="hidden" />
              <span className="font-bold text-sm">Ca 1 (Sáng)</span>
            </label>
            <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedShift === 'Ca Lỡ' ? 'border-primary bg-primary/5 text-primary dark:bg-primary/20' : 'border-outline-variant dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              <input type="radio" name="shift" value="Ca Lỡ" checked={selectedShift === 'Ca Lỡ'} onChange={(e) => setSelectedShift(e.target.value)} className="hidden" />
              <span className="font-bold text-sm">Ca Lỡ (Giữa ca)</span>
            </label>
            <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedShift === 'Ca 2' ? 'border-primary bg-primary/5 text-primary dark:bg-primary/20' : 'border-outline-variant dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              <input type="radio" name="shift" value="Ca 2" checked={selectedShift === 'Ca 2'} onChange={(e) => setSelectedShift(e.target.value)} className="hidden" />
              <span className="font-bold text-sm">Ca 2 (Chiều/Tối)</span>
            </label>
          </div>
        </div>

        {/* Nhóm 1: Nhân sự */}
        <div className="bg-white dark:bg-[#1e1e1e] p-5 rounded-2xl border border-outline-variant dark:border-gray-800 shadow-sm">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-gray-400">groups</span> Nhóm 1 - Nhân Sự
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderHRSegment('Lễ tân', 'hr_letan')}
            {renderHRSegment('Bảo vệ', 'hr_baove')}
            {renderHRSegment('Clocker', 'hr_clocker')}
            {renderHRSegment('KTV', 'hr_ktv')}
          </div>
          
          <div className="mt-4 p-4 border border-outline-variant dark:border-gray-700 bg-surface-container-highest dark:bg-[#1a1a1a] rounded-xl flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex flex-col gap-2 bg-white dark:bg-[#252525] p-3 rounded-lg border border-gray-200 dark:border-gray-600">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-error flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-error"></span> Số lượng Nghỉ không phép</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setVal('manual_unauth', Math.max(0, (formData.manual_unauth || 0) - 1))} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 text-gray-700 dark:text-gray-300 transition-colors font-bold select-none" disabled={isSubmitted}>-</button>
                  <input 
                    type="number" 
                    min="0" 
                    value={formData.manual_unauth !== undefined ? formData.manual_unauth : 0} 
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0) setVal('manual_unauth', val);
                    }}
                    onBlur={(e) => {
                      if (e.target.value === '' || isNaN(parseInt(e.target.value))) setVal('manual_unauth', 0);
                    }}
                    className="w-12 text-center font-bold text-error bg-transparent outline-none border-none appearance-none" 
                  />
                  <button type="button" onClick={() => setVal('manual_unauth', (formData.manual_unauth || 0) + 1)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 text-gray-700 dark:text-gray-300 transition-colors font-bold select-none">+</button>
                </div>
              </div>
              {formData.manual_unauth > 0 && (
                <input 
                  type="text" 
                  placeholder="Nhập ghi chú lý do/phương án..." 
                  value={formData.manual_unauth_note || ''} 
                  onChange={(e) => setVal('manual_unauth_note', e.target.value)} 
                  className={`w-full mt-1 px-3 py-2 bg-gray-50 dark:bg-[#1a1a1a] border rounded-lg text-sm outline-none transition-all ${(!formData.manual_unauth_note || !formData.manual_unauth_note.trim()) && !isSubmitted ? 'border-error focus:ring-1 focus:ring-error' : 'border-gray-200 dark:border-gray-700 focus:ring-1 focus:ring-primary'} dark:text-white`} 
                />
              )}
            </div>
            <div className="flex-1 flex flex-col gap-2 bg-white dark:bg-[#252525] p-3 rounded-lg border border-gray-200 dark:border-gray-600">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-orange-500 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500"></span> Số lượng Nghỉ có phép</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setVal('manual_auth', Math.max(0, (formData.manual_auth || 0) - 1))} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 text-gray-700 dark:text-gray-300 transition-colors font-bold select-none">-</button>
                  <input 
                    type="number" 
                    min="0" 
                    value={formData.manual_auth !== undefined ? formData.manual_auth : 0} 
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0) setVal('manual_auth', val);
                    }}
                    onBlur={(e) => {
                      if (e.target.value === '' || isNaN(parseInt(e.target.value))) setVal('manual_auth', 0);
                    }}
                    className="w-12 text-center font-bold text-orange-500 bg-transparent outline-none border-none appearance-none" 
                  />
                  <button type="button" onClick={() => setVal('manual_auth', (formData.manual_auth || 0) + 1)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 text-gray-700 dark:text-gray-300 transition-colors font-bold select-none">+</button>
                </div>
              </div>
              {formData.manual_auth > 0 && (
                <input 
                  type="text" 
                  placeholder="Nhập ghi chú lý do/phương án..." 
                  value={formData.manual_auth_note || ''} 
                  onChange={(e) => setVal('manual_auth_note', e.target.value)} 
                  className={`w-full mt-1 px-3 py-2 bg-gray-50 dark:bg-[#1a1a1a] border rounded-lg text-sm outline-none transition-all ${(!formData.manual_auth_note || !formData.manual_auth_note.trim()) && !isSubmitted ? 'border-error focus:ring-1 focus:ring-error' : 'border-gray-200 dark:border-gray-700 focus:ring-1 focus:ring-primary'} dark:text-white`} 
                />
              )}
            </div>
          </div>
        </div>

        {/* Nhóm 2: Thiết bị */}
        <div className="bg-white dark:bg-[#1e1e1e] p-5 rounded-2xl border border-outline-variant dark:border-gray-800 shadow-sm">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-gray-400">build</span> Nhóm 2 - Thiết Bị & Cơ Sở Vật Chất
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {renderSegment('Camera', 'eq_camera', 'binh_thuong', 'B.Thường', 'su_co', 'Sự cố')}
            {renderSegment('Máy tính', 'eq_maytinh', 'binh_thuong', 'B.Thường', 'su_co', 'Sự cố')}
            {renderSegment('Đèn bảng hiệu', 'eq_den', 'binh_thuong', 'B.Thường', 'su_co', 'Sự cố')}
            {renderSegment('Máy lạnh', 'eq_maylanh', 'binh_thuong', 'B.Thường', 'su_co', 'Sự cố')}
          </div>
          <input type="text" placeholder="Ghi chú thêm thiết bị khác (nếu có)..." value={formData.eq_other} onChange={e => setVal('eq_other', e.target.value)} className={`w-full px-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white`} />
        </div>

        {/* Nhóm 3: Vệ sinh */}
        <div className={`bg-white dark:bg-[#1e1e1e] p-5 rounded-2xl border border-outline-variant dark:border-gray-800 shadow-sm`}>
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-gray-400">cleaning_services</span> Nhóm 3 - Vệ Sinh
          </h3>
          <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${formData.cleaning_done ? 'border-success bg-success/5 dark:bg-success/10' : 'border-outline-variant dark:border-gray-700 bg-surface-container-low dark:bg-[#252525] hover:bg-surface-container-high'}`}>
            <div className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${formData.cleaning_done ? 'bg-success border-success text-white' : 'border-gray-400 dark:border-gray-600'}`}>
              {formData.cleaning_done && <span className="material-symbols-outlined text-[18px]">check</span>}
            </div>
            <input type="checkbox" checked={formData.cleaning_done} onChange={e => setVal('cleaning_done', e.target.checked)} className="hidden" />
            <span className="font-bold text-sm dark:text-white">Xác nhận vệ sinh cơ sở đã hoàn tất (Sạch sẽ)</span>
          </label>
        </div>

      </form>

        <div className="p-6 border-t border-outline-variant dark:border-gray-800 bg-surface-container-low dark:bg-[#1a1a1a] flex flex-col items-end gap-3 shrink-0 rounded-b-2xl">
          {!isFormValid && ((formData.manual_unauth > 0 && (!formData.manual_unauth_note || !formData.manual_unauth_note.trim())) || (formData.manual_auth > 0 && (!formData.manual_auth_note || !formData.manual_auth_note.trim()))) && !isSubmitted && (
            <div className="w-full text-right text-xs text-error font-medium">
              Bạn đã nhập Số lượng nghỉ, hệ thống bắt buộc phải ghi chú phương án/lý do cho nhân sự tương ứng.
            </div>
          )}
          {!isFormValid && ['eq_camera', 'eq_maytinh', 'eq_den', 'eq_maylanh'].some(field => formData[field] === 'su_co' && (!formData[field + '_note'] || !formData[field + '_note'].trim())) && !isSubmitted && (
            <div className="w-full text-right text-xs text-error font-medium">
              Vui lòng nhập mô tả sự cố cho thiết bị đã chọn.
            </div>
          )}
          {isSubmitted ? (
            <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-success bg-success/10 border border-success/20 w-full justify-center">
              <span className="material-symbols-outlined">check_circle</span>
              Ca làm việc này đã hoàn tất báo cáo lúc {submittedTime}
            </div>
          ) : (
            <button type="submit" onClick={handleSubmit} disabled={loading || !isFormValid} className="bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md shadow-primary/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">how_to_reg</span>}
              Xác nhận Check-in
            </button>
          )}
        </div>
      </div>

      </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white dark:bg-[#1e1e1e] w-full rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col animate-fade-in">
          <div className="p-6 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-primary/10 to-transparent flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-on-surface dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-2xl">history</span>
                Lịch Sử Báo Cáo các Ca làm việc
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Cơ sở: <span className="font-bold text-primary dark:text-blue-400">{user?.facility_id}</span></p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">search</span>
                <input 
                  type="text" 
                  placeholder="Tìm từ khóa..." 
                  value={historyFilterSearch}
                  onChange={e => setHistoryFilterSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none dark:text-white"
                />
              </div>
              
              <div className="relative">
                <input 
                  type="date" 
                  value={historyFilterDate}
                  onChange={e => setHistoryFilterDate(e.target.value)}
                  className="px-4 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none dark:text-white cursor-pointer"
                />
              </div>
              
              <label className="flex items-center gap-2 cursor-pointer border border-outline-variant dark:border-gray-700 px-3 py-2 rounded-lg bg-surface-container-low dark:bg-[#252525] hover:bg-gray-100 dark:hover:bg-[#333] transition-colors">
                <input 
                  type="checkbox" 
                  checked={historyFilterHasImage}
                  onChange={e => setHistoryFilterHasImage(e.target.checked)}
                  className="rounded text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium dark:text-white flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">image</span> Có ảnh</span>
              </label>
            </div>
          </div>
          
          <div className="p-6 overflow-y-auto max-h-[600px] custom-scrollbar">
            {(() => {
              const filterDateObj = new Date(historyFilterDate);
              const formattedFilterDate = isNaN(filterDateObj.getTime()) ? today : filterDateObj.toLocaleDateString('vi-VN');
              
              const filteredCheckins = checkins.filter(c => c.facility_id === user.facility_id)
                .filter(c => c.date === formattedFilterDate)
                .filter(c => historyFilterSearch ? JSON.stringify(c.formData).toLowerCase().includes(historyFilterSearch.toLowerCase()) : true)
                .sort((a,b) => b.id - a.id);
              
              if (filteredCheckins.length === 0) {
                return (
                  <div className="text-center py-10 flex flex-col items-center justify-center opacity-60">
                    <span className="material-symbols-outlined text-4xl mb-2 text-gray-400">inbox</span>
                    <p className="text-sm">Không có báo cáo nào phù hợp với bộ lọc hiện tại.</p>
                  </div>
                );
              }
              
              return (
                <div className="flex flex-col lg:flex-row gap-6 items-start relative">
                  <div className="flex-1 flex flex-col gap-4 relative w-full border-l-2 border-gray-100 dark:border-gray-800 ml-3 pl-6">
                    {filteredCheckins.map(checkinForDate => (
                      <div key={checkinForDate.id} className="relative">
                        <div className="absolute -left-[33px] top-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_#1e1e1e]"></div>
                        <div className="flex flex-col gap-2 w-full">
                          <span className="text-xs font-bold text-primary">{checkinForDate.timestamp}</span>
                          <div className="bg-surface-container-lowest dark:bg-[#252525] p-4 rounded-xl border border-outline-variant dark:border-gray-700 hover:shadow-md transition-shadow">
                            <h4 className="text-sm font-bold border-b border-gray-200 dark:border-gray-600 pb-2 mb-3 flex items-center gap-2 dark:text-white">
                              <span className="material-symbols-outlined text-primary text-[18px]">fact_check</span>
                              Báo cáo {checkinForDate.shift}
                            </h4>
                            <div className="space-y-3">
                              <div className="text-xs flex justify-between bg-surface-container dark:bg-[#1a1a1a] p-2 rounded-lg">
                                <span className="text-gray-500">Giờ báo cáo:</span>
                                <span className="font-bold dark:text-white">{checkinForDate.timestamp}</span>
                              </div>
                              <div className="text-xs flex justify-between bg-error/10 dark:bg-error/20 text-error p-2 rounded-lg font-bold">
                                <span>Nghỉ không phép:</span>
                                <span>{checkinForDate.formData.manual_unauth || 0}</span>
                              </div>
                              <div className="text-xs flex justify-between bg-orange-500/10 dark:bg-orange-500/20 text-orange-500 p-2 rounded-lg font-bold">
                                <span>Nghỉ có phép:</span>
                                <span>{checkinForDate.formData.manual_auth || 0}</span>
                              </div>
                              
                              {['eq_camera', 'eq_maytinh', 'eq_den', 'eq_maylanh'].some(field => checkinForDate.formData[field] === 'su_co') && (
                                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                  <span className="text-xs font-bold text-gray-500 mb-2 block">Ghi nhận Sự cố:</span>
                                  {['eq_camera', 'eq_maytinh', 'eq_den', 'eq_maylanh'].map(field => {
                                    if(checkinForDate.formData[field] === 'su_co') {
                                      const names = { eq_camera: 'Camera', eq_maytinh: 'Máy tính', eq_den: 'Đèn', eq_maylanh: 'Máy lạnh' };
                                      return (
                                        <div key={field} className="text-xs text-error mb-1 flex flex-col gap-1 bg-white dark:bg-[#1a1a1a] p-2 rounded border border-error/20">
                                          <span className="font-bold">{names[field]}</span>
                                          <span className="opacity-80 italic">{checkinForDate.formData[field + '_note']}</span>
                                        </div>
                                      )
                                    }
                                    return null;
                                  })}
                                </div>
                              )}
                              
                              {['hr_letan', 'hr_baove', 'hr_clocker', 'hr_ktv'].some(key => checkinForDate.formData[key].status === 'thieu') && (
                                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                  <span className="text-xs font-bold text-gray-500 mb-2 block">Cần hỗ trợ nhân sự:</span>
                                  {['hr_letan', 'hr_baove', 'hr_clocker', 'hr_ktv'].map(field => {
                                    if(checkinForDate.formData[field].status === 'thieu') {
                                      const names = { hr_letan: 'Lễ tân', hr_baove: 'Bảo vệ', hr_clocker: 'Clocker', hr_ktv: 'KTV' };
                                      return (
                                        <div key={field} className="text-xs text-orange-600 mb-1 flex flex-col gap-1 bg-white dark:bg-[#1a1a1a] p-2 rounded border border-orange-500/20">
                                          <span className="font-bold">{names[field]}</span>
                                          <span className="opacity-80 italic">{checkinForDate.formData[field].note}</span>
                                        </div>
                                      )
                                    }
                                    return null;
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {activeTab === 'log_history' && (
        <div className="bg-white dark:bg-[#1e1e1e] w-full rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col animate-fade-in">
          <div className="p-6 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-secondary/10 to-transparent flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-on-surface dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-2xl">history_edu</span>
                Lịch Sử Nhật Ký Vận Hành
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Cơ sở: <span className="font-bold text-secondary dark:text-purple-400">{user?.facility_id}</span></p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">search</span>
                <input 
                  type="text" 
                  placeholder="Tìm từ khóa..." 
                  value={logFilterSearch}
                  onChange={e => setLogFilterSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-secondary outline-none dark:text-white"
                />
              </div>
              
              <div className="relative">
                <input 
                  type="date" 
                  value={logFilterDate}
                  onChange={e => setLogFilterDate(e.target.value)}
                  className="px-4 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-secondary outline-none dark:text-white cursor-pointer"
                />
              </div>
              
              <label className="flex items-center gap-2 cursor-pointer border border-outline-variant dark:border-gray-700 px-3 py-2 rounded-lg bg-surface-container-low dark:bg-[#252525] hover:bg-gray-100 dark:hover:bg-[#333] transition-colors">
                <input 
                  type="checkbox" 
                  checked={logFilterHasImage}
                  onChange={e => setLogFilterHasImage(e.target.checked)}
                  className="rounded text-secondary focus:ring-secondary"
                />
                <span className="text-sm font-medium dark:text-white flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">image</span> Có ảnh</span>
              </label>
            </div>
          </div>
          
          <div className="p-6 overflow-y-auto max-h-[600px] custom-scrollbar">
            {(() => {
              const filterDateObj = new Date(logFilterDate);
              const formattedFilterDate = isNaN(filterDateObj.getTime()) ? today : filterDateObj.toLocaleDateString('vi-VN');
              
              const filteredLogs = logs.filter(l => l.facility_id === user.facility_id)
                .filter(l => l.date === formattedFilterDate)
                .filter(l => logFilterSearch ? l.content.toLowerCase().includes(logFilterSearch.toLowerCase()) : true)
                .filter(l => logFilterHasImage ? !!l.image : true);
              
              const checkinsForDate = checkins.filter(c => c.facility_id === user.facility_id && c.date === formattedFilterDate);
              
              if (filteredLogs.length === 0) {
                return (
                  <div className="text-center py-10 flex flex-col items-center justify-center opacity-60">
                    <span className="material-symbols-outlined text-4xl mb-2 text-gray-400">inbox</span>
                    <p className="text-sm">Không có nhật ký nào phù hợp với bộ lọc hiện tại.</p>
                  </div>
                );
              }
              
              return (
                <div className="flex flex-col lg:flex-row gap-6 items-start relative">
                  <div className="flex-1 flex flex-col gap-4 relative w-full border-l-2 border-gray-100 dark:border-gray-800 ml-3 pl-6">
                    {filteredLogs.map((log) => (
                      <div key={log.id} className="relative">
                        <div className="absolute -left-[33px] top-1 w-4 h-4 rounded-full bg-secondary flex items-center justify-center shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_#1e1e1e]"></div>
                        <div className="flex flex-col gap-2 w-full">
                          <span className="text-xs font-bold text-secondary">{log.timestamp}</span>
                          <div className="bg-gray-50 dark:bg-[#252525] p-4 rounded-xl border border-gray-100 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 break-words hover:shadow-md transition-shadow">
                            <p className="whitespace-pre-line">{log.content}</p>
                            {log.image && (
                              <div className="mt-3">
                                <img src={log.image} alt="Log Attachment" className="max-h-48 rounded-lg border border-gray-200 dark:border-gray-600 object-cover" />
                              </div>
                            )}
                            {log.audio && (
                              <div className="mt-3">
                                <audio controls src={log.audio} className="w-full h-10" />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {checkinsForDate.length > 0 && (
                    <div className="w-full lg:w-80 flex flex-col gap-4 sticky top-0 shrink-0">
                      {checkinsForDate.map(checkinForDate => (
                        <div key={checkinForDate.id} className="bg-surface-container-lowest dark:bg-[#252525] rounded-xl border border-outline-variant dark:border-gray-700 p-4 shadow-sm">
                          <h4 className="text-sm font-bold border-b border-gray-200 dark:border-gray-600 pb-2 mb-3 flex items-center gap-2 dark:text-white">
                            <span className="material-symbols-outlined text-primary text-[18px]">fact_check</span>
                            Báo cáo {checkinForDate.shift}
                          </h4>
                          <div className="space-y-3">
                            <div className="text-xs flex justify-between bg-surface-container dark:bg-[#1a1a1a] p-2 rounded-lg">
                              <span className="text-gray-500">Giờ báo cáo:</span>
                              <span className="font-bold dark:text-white">{checkinForDate.timestamp}</span>
                            </div>
                            <div className="text-xs flex justify-between bg-error/10 dark:bg-error/20 text-error p-2 rounded-lg font-bold">
                              <span>Nghỉ không phép:</span>
                              <span>{checkinForDate.formData.manual_unauth || 0}</span>
                            </div>
                            <div className="text-xs flex justify-between bg-orange-500/10 dark:bg-orange-500/20 text-orange-500 p-2 rounded-lg font-bold">
                              <span>Nghỉ có phép:</span>
                              <span>{checkinForDate.formData.manual_auth || 0}</span>
                            </div>
                            
                            {['eq_camera', 'eq_maytinh', 'eq_den', 'eq_maylanh'].some(field => checkinForDate.formData[field] === 'su_co') && (
                              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <span className="text-xs font-bold text-gray-500 mb-2 block">Ghi nhận Sự cố:</span>
                                {['eq_camera', 'eq_maytinh', 'eq_den', 'eq_maylanh'].map(field => {
                                  if(checkinForDate.formData[field] === 'su_co') {
                                    const names = { eq_camera: 'Camera', eq_maytinh: 'Máy tính', eq_den: 'Đèn', eq_maylanh: 'Máy lạnh' };
                                    return (
                                      <div key={field} className="text-xs text-error mb-1 flex flex-col gap-1 bg-white dark:bg-[#1a1a1a] p-2 rounded border border-error/20">
                                        <span className="font-bold">{names[field]}</span>
                                        <span className="opacity-80 italic">{checkinForDate.formData[field + '_note']}</span>
                                      </div>
                                    )
                                  }
                                  return null;
                                })}
                              </div>
                            )}
                            
                            {['hr_letan', 'hr_baove', 'hr_clocker', 'hr_ktv'].some(key => checkinForDate.formData[key].status === 'thieu') && (
                              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <span className="text-xs font-bold text-gray-500 mb-2 block">Cần hỗ trợ nhân sự:</span>
                                {['hr_letan', 'hr_baove', 'hr_clocker', 'hr_ktv'].map(field => {
                                  if(checkinForDate.formData[field].status === 'thieu') {
                                    const names = { hr_letan: 'Lễ tân', hr_baove: 'Bảo vệ', hr_clocker: 'Clocker', hr_ktv: 'KTV' };
                                    return (
                                      <div key={field} className="text-xs text-orange-600 mb-1 flex flex-col gap-1 bg-white dark:bg-[#1a1a1a] p-2 rounded border border-orange-500/20">
                                        <span className="font-bold">{names[field]}</span>
                                        <span className="opacity-80 italic">{checkinForDate.formData[field].note}</span>
                                      </div>
                                    )
                                  }
                                  return null;
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}
