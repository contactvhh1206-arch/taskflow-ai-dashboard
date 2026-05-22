
    const { useState, useEffect, createContext, useContext } = React;

    const AuthContext = createContext();

    const generateId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);

    const INITIAL_TASKS = [
      { id: generateId(), title: 'Bảo trì máy lạnh cơ sở 1', description: '', status: 'todo', facilityId: 'Cơ sở 1', pic: 'Quản lý Cơ sở 1', deadline: '2026-05-14', urgent: true, createdAt: '2026-05-13', historyLog: [] },
      { id: generateId(), title: 'Lên chiến dịch Flash Sale', description: '', status: 'in_progress', facilityId: 'Toàn hệ thống', pic: 'Trần Thị B', deadline: '2026-05-16', urgent: false, createdAt: '2026-05-14', historyLog: [] },
      { id: generateId(), title: 'Nghiệm thu KPI tháng 4', description: '', status: 'review', facilityId: 'Cơ sở 2', pic: 'Lê Văn C', deadline: '2026-05-14', urgent: true, createdAt: '2026-05-01', completedAt: '2026-05-15', historyLog: [] },
      { id: generateId(), title: 'Cập nhật tài liệu onboarding', description: '', status: 'done', facilityId: 'HQ', pic: 'Phạm D', deadline: '2026-05-10', urgent: false, createdAt: '2026-05-05', completedAt: '2026-05-09', historyLog: [] },
      { id: generateId(), title: 'Task tháng trước', description: '', status: 'done', facilityId: 'Cơ sở 1', pic: 'Quản lý Cơ sở 1', deadline: '2026-04-20', urgent: false, createdAt: '2026-04-10', completedAt: '2026-04-19', historyLog: [] }
    ];

    const AI_INSIGHTS = [
      { id: 1, title: 'Cảnh báo Tiến độ', desc: 'Task "Nghiệm thu KPI tháng 4" sắp trễ hạn. Đề xuất gửi AI Ping đôn đốc.', type: 'warning' },
      { id: 2, title: 'Tối ưu Nguồn lực', desc: 'Cơ sở 1 đang quá tải 20% so với định mức. Có thể điều phối nhân sự từ Cơ sở 2 sang hỗ trợ.', type: 'info' },
    ];

    // --- COMPONENT DAILY CHECKIN ---
    function DailyCheckin({ onCheckinSuccess, showToast }) {
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
        const fetchAll = () => {
          const attendanceData = window.DataService.fetchHistory({ entry_type: 'Attendance' });
          setCheckins(attendanceData.map(item => ({
            id: item.id,
            facility_id: item.org_unit,
            date: item.date,
            shift: item.content.shift,
            timestamp: item.displayTime,
            formData: item.content,
            aiVectorData: item.aiVectorData
          })));

          const logsData = window.DataService.fetchHistory({ entry_type: 'Operation_Log' });
          setLogs(logsData.map(item => ({
            id: item.id,
            facility_id: item.org_unit,
            date: item.date,
            timestamp: item.displayTime,
            content: item.content,
            image: item.attachments[0] || null,
            aiVectorData: item.aiVectorData
          })));
        };
        fetchAll();
      }, []);

      const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setLogImage(reader.result);
          };
          reader.readAsDataURL(file);
        }
      };

      const handleAddLog = () => {
        if (!logContent.trim() && !logImage) return;

        const now = new Date();
        const timestamp = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

        const aiVectorData = `[${timestamp}] CƠ SỞ ${user.facility_id} | NHẬT KÝ: ${logContent.trim() || 'Không có nội dung'} ${logImage ? '| CÓ ẢNH ĐÍNH KÈM' : ''}`;

        const newRecord = window.DataService.saveData({
          org_unit: user.facility_id,
          entry_type: 'Operation_Log',
          content: logContent.trim(),
          attachments: logImage ? [logImage] : [],
          aiVectorData
        });

        const mappedLog = {
          id: newRecord.id,
          facility_id: newRecord.org_unit,
          date: newRecord.date,
          timestamp: newRecord.displayTime,
          content: newRecord.content,
          image: newRecord.attachments[0] || null,
          aiVectorData: newRecord.aiVectorData
        };

        setLogs([mappedLog, ...logs]);
        setLogContent('');
        setLogImage(null);
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
        (sumManual > 0 ? ['hr_letan', 'hr_baove', 'hr_clocker', 'hr_ktv'].some(key => formData[key].status === 'thieu') : true);



      console.log('--- FORM STATE ---', formData, '| IS_VALID:', isFormValid);

      const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isFormValid || isSubmitted) return;

        setLoading(true);
        setTimeout(() => {
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
              { k: 'eq_camera', n: 'Camera' },
              { k: 'eq_maytinh', n: 'Máy tính' },
              { k: 'eq_den', n: 'Đèn' },
              { k: 'eq_maylanh', n: 'Máy lạnh' }
            ].filter(e => formData[e.k] === 'su_co')
              .map(e => `${e.n.toUpperCase()}: ${formData[e.k + '_note']}`)
              .join(' | ');
          };
          const currentSumManual = (formData.manual_auth || 0) + (formData.manual_unauth || 0);
          const eqNotesStr = getEqNotes();
          const aiVectorData = `[${timestamp}] CƠ SỞ ${user.facility_id} | CA ${selectedShift} | NGHỈ: ${currentSumManual} (CP: ${formData.manual_auth || 0}, KP: ${formData.manual_unauth || 0}) | HỖ TRỢ: ${getNotes() || 'Không có'} | SỰ CỐ: ${eqNotesStr || 'Không có'}`;

          const newRecord = window.DataService.saveData({
            org_unit: user.facility_id,
            entry_type: 'Attendance',
            content: { ...formData, shift: selectedShift },
            attachments: [],
            aiVectorData
          });

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

          setLoading(false);
        }, 800);
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
                    <div className="relative w-max">
                      <img src={logImage} alt="Preview" className="h-24 rounded-lg border border-gray-200 dark:border-gray-700 object-cover" />
                      <button onClick={() => setLogImage(null)} className="absolute -top-2 -right-2 w-6 h-6 bg-error text-white rounded-full flex items-center justify-center hover:bg-error/90 shadow-sm">
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl cursor-pointer transition-colors text-sm font-semibold">
                      <span className="material-symbols-outlined text-[18px]">image</span> Đính kèm ảnh
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                    <button onClick={handleAddLog} disabled={!logContent.trim() && !logImage} className="bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-white px-6 py-2 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center gap-2">
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
                      <div className="flex-1 flex items-center justify-between bg-white dark:bg-[#252525] p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                        <span className="text-sm font-bold text-error flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-error"></span> Số lượng Nghỉ không phép</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setVal('manual_unauth', Math.max(0, (formData.manual_unauth || 0) - 1))} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 text-gray-700 dark:text-gray-300 transition-colors font-bold select-none">-</button>
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
                      <div className="flex-1 flex items-center justify-between bg-white dark:bg-[#252525] p-3 rounded-lg border border-gray-200 dark:border-gray-600">
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
                  {!isFormValid && sumManual > 0 && !['hr_letan', 'hr_baove', 'hr_clocker', 'hr_ktv'].some(key => formData[key].status === 'thieu') && !isSubmitted && (
                    <div className="w-full text-right text-xs text-error font-medium">
                      Bạn đã nhập Số lượng nghỉ, hệ thống bắt buộc phải chọn "Cần hỗ trợ" và ghi chú phương án cho nhân sự tương ứng.
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
                    .sort((a, b) => b.id - a.id);

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
                                        if (checkinForDate.formData[field] === 'su_co') {
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
                                        if (checkinForDate.formData[field].status === 'thieu') {
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
                                      if (checkinForDate.formData[field] === 'su_co') {
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
                                      if (checkinForDate.formData[field].status === 'thieu') {
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

    // --- COMPONENT LOGIN ---
    function Login() {
      const { login } = useContext(AuthContext);
      const [username, setUsername] = useState('');
      const [password, setPassword] = useState('');
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(false);

      const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
          const response = await fetch('http://localhost:3000/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });

          let data;
          if (response.ok) {
            data = await response.json();
          } else {
            if (username === 'admin' && password === 'admin123') {
              data = { success: true, token: 'mock-admin', user: { name: 'Sếp Tổng', role: 'SUPER_ADMIN', facility_id: 'ALL' } };
            } else if (username === 'manager1' && password === 'manager123') {
              data = { success: true, token: 'mock-manager', user: { name: 'Quản lý Cơ sở 1', role: 'FACILITY_MANAGER', facility_id: 'Cơ sở 1' } };
            } else {
              throw new Error('Tài khoản hoặc mật khẩu không chính xác.');
            }
          }

          if (data.success) {
            login(data.user, data.token);
          } else {
            setError(data.error);
          }
        } catch (err) {
          if (username === 'admin' && password === 'admin123') {
            login({ name: 'Sếp Tổng', role: 'SUPER_ADMIN', facility_id: 'ALL' }, 'mock-admin');
          } else if (username === 'manager1' && password === 'manager123') {
            login({ name: 'Quản lý Cơ sở 1', role: 'FACILITY_MANAGER', facility_id: 'Cơ sở 1' }, 'mock-manager');
          } else {
            setError(err.message || 'Tài khoản hoặc mật khẩu không chính xác.');
          }
        } finally {
          setLoading(false);
        }
      };

      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-container dark:bg-[#121212] relative overflow-hidden transition-colors w-full h-full">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-3xl mix-blend-multiply animate-pulse"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-3xl mix-blend-multiply animate-pulse delay-1000"></div>

          <div className="glass-panel w-full max-w-md p-8 rounded-2xl shadow-2xl relative z-10 dark:bg-[#1e1e1e]/80">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-primary mx-auto flex items-center justify-center text-white shadow-lg shadow-primary/30 mb-4 transform rotate-3 hover:rotate-0 transition-transform">
                <span className="material-symbols-outlined text-3xl">hub</span>
              </div>
              <h1 className="text-2xl font-display font-bold text-on-surface dark:text-white">TaskFlow AI</h1>
              <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">Hệ thống Điều phối Công việc Toàn chuỗi</p>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container text-sm font-medium flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">error</span> {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-on-surface dark:text-gray-300 mb-1.5">Tài khoản</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">person</span>
                  <input type="text" required value={username} onChange={e => setUsername(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all dark:text-white" placeholder="admin" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface dark:text-gray-300 mb-1.5">Mật khẩu</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">lock</span>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all dark:text-white" placeholder="••••••••" />
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-xl transition-all shadow-md shadow-primary/20 flex items-center justify-center gap-2">
                {loading ? <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span> : <>Đăng nhập <span className="material-symbols-outlined text-[18px]">arrow_forward</span></>}
              </button>
            </form>
            <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-700/50">
              <p className="text-xs text-center text-gray-500 dark:text-gray-400 mb-3">Tài khoản trải nghiệm:</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setUsername('admin'); setPassword('admin123'); }} className="text-xs py-2 px-3 rounded-lg border border-outline-variant dark:border-gray-700 hover:bg-surface-variant dark:hover:bg-gray-800 transition-colors dark:text-gray-300">
                  <span className="font-bold block">Sếp tổng</span> admin
                </button>
                <button onClick={() => { setUsername('manager1'); setPassword('manager123'); }} className="text-xs py-2 px-3 rounded-lg border border-outline-variant dark:border-gray-700 hover:bg-surface-variant dark:hover:bg-gray-800 transition-colors dark:text-gray-300">
                  <span className="font-bold block">Quản lý</span> manager1
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    function TaskCreationModal({ onClose, onSave, defaultStatus, user }) {
      const [formData, setFormData] = useState({
        title: '',
        desc: '',
        pic: user.name,
        deadline: new Date().toISOString().split('T')[0],
        status: defaultStatus || 'todo',
        urgent: false
      });

      const handleSubmit = (e) => {
        e.preventDefault();
        onSave({
          id: Date.now(),
          ...formData,
          facility: user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id
        });
        onClose();
      };

      const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
      };

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant dark:border-gray-800 p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-on-surface dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">add_task</span>
                Tạo công việc mới
              </h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Tiêu đề công việc <span className="text-error">*</span></label>
                <input required autoFocus type="text" name="title" value={formData.title} onChange={handleChange} className="w-full px-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white" placeholder="VD: Sửa máy lạnh phòng VIP 1" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Mô tả chi tiết</label>
                <textarea name="desc" value={formData.desc} onChange={handleChange} className="w-full h-24 px-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white resize-none" placeholder="Ghi chú thêm (không bắt buộc)..." />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Người phụ trách (PIC)</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">person</span>
                    <input required type="text" name="pic" value={formData.pic} onChange={handleChange} className="w-full pl-9 pr-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Deadline</label>
                  <input required type="date" name="deadline" value={formData.deadline} onChange={handleChange} className="w-full px-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white" />
                </div>
              </div>

              <div className="p-3 bg-surface-container dark:bg-[#252525] rounded-xl flex items-center justify-between border border-outline-variant dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-error">error</span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Đánh dấu khẩn cấp</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" name="urgent" checked={formData.urgent} onChange={handleChange} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/10 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-error"></div>
                </label>
              </div>

            </form>
            <div className="mt-6 pt-4 border-t border-outline-variant dark:border-gray-800 flex justify-end gap-3 shrink-0">
              <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">Hủy bỏ</button>
              <button onClick={handleSubmit} disabled={!formData.title} className="bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-md shadow-primary/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <span className="material-symbols-outlined text-[18px]">save</span>
                Tạo công việc
              </button>
            </div>
          </div>
        </div>
      );
    }

    function AITaskModal({ onClose, onConfirm, user }) {
      const [text, setText] = useState('');
      const [isAnalyzing, setIsAnalyzing] = useState(false);

      const handleAnalyze = () => {
        if (!text.trim()) return;
        setIsAnalyzing(true);
        try {
          setTimeout(() => {
            try {
              const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');
              const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

              const rawSentences = text.split(/(?<=[.!?\n])\s+/);
              const validSentences = rawSentences.filter(s => s.trim().length > 10).slice(0, 3);

              let dynamicTasks = [];
              if (validSentences.length > 0) {
                dynamicTasks = validSentences.map((sentence) => {
                  let pic = user?.name || 'Unknown';
                  const sLow = sentence.toLowerCase();
                  if (sLow.includes('anh a') || sLow.includes('văn a')) pic = 'Nguyễn Văn A';
                  else if (sLow.includes('chị b') || sLow.includes('thị b')) pic = 'Trần Thị B';
                  else if (sLow.includes('anh c') || sLow.includes('văn c')) pic = 'Lê Văn C';

                  const isUrgent = sLow.includes('gấp') || sLow.includes('ngay') || sLow.includes('khẩn') || sLow.includes('trước ngày mai') || sLow.includes('asap');
                  const cleanTitle = sentence.trim().replace(/^[-*+\s\d.]+/, '');

                  return {
                    id: generateId(),
                    title: cleanTitle.length > 70 ? cleanTitle.substring(0, 70) + '...' : cleanTitle,
                    description: sentence.trim(),
                    pic: pic,
                    deadline: new Date().toISOString().split('T')[0],
                    status: 'todo',
                    urgent: isUrgent,
                    facilityId: user?.role === 'SUPER_ADMIN' ? 'HQ' : (user?.facility_id || 'Unknown'),
                    historyLog: [{ time: now, event: 'AI tự động trích xuất công việc' }]
                  };
                });
              } else {
                dynamicTasks = [
                  {
                    id: generateId(),
                    title: text.trim().substring(0, 60) + (text.trim().length > 60 ? '...' : ''),
                    description: text.trim(),
                    pic: user?.name || 'Unknown',
                    deadline: new Date().toISOString().split('T')[0],
                    status: 'todo',
                    urgent: false,
                    facilityId: user?.role === 'SUPER_ADMIN' ? 'HQ' : (user?.facility_id || 'Unknown'),
                    historyLog: [{ time: now, event: 'AI tự động trích xuất công việc' }]
                  }
                ];
              }
              onConfirm(dynamicTasks);
              onClose();
            } catch (err) {
              console.error('Error inside setTimeout:', err);
              setIsAnalyzing(false);
            }
          }, 1000);
        } catch (error) {
          console.error("Lỗi khi xử lý AI:", error);
          setIsAnalyzing(false);
        }
      };

      return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: 'white', width: '100%', maxWidth: '600px', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }} className="dark:bg-[#1e1e1e]">
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }} className="dark:text-white">✨ Tạo nhanh bằng AI</h2>
            <p style={{ margin: 0, fontSize: '14px', color: '#666' }} className="dark:text-gray-400">Dán nội dung tin nhắn chỉ đạo hoặc biên bản họp. AI sẽ tự động phân tích và bóc tách thành các công việc cụ thể.</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="VD: Hôm nay họp bàn giao..."
              style={{ width: '100%', height: '150px', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none', resize: 'none' }}
              className="dark:bg-[#252525] dark:border-gray-700 dark:text-white"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                onClick={onClose}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#f3f4f6', cursor: 'pointer', fontWeight: 'bold', color: '#333' }}
                className="dark:bg-gray-800 dark:text-white"
              >
                Hủy
              </button>
              <button
                onClick={handleAnalyze}
                disabled={!text.trim() || isAnalyzing}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#8b5cf6', color: 'white', cursor: (!text.trim() || isAnalyzing) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (!text.trim() || isAnalyzing) ? 0.5 : 1 }}
              >
                {isAnalyzing ? 'Đang trích xuất...' : 'Trích xuất'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    function AIAdvisor() {
      const [query, setQuery] = useState('');
      const [chatLog, setChatLog] = useState([
        { role: 'ai', content: 'Chào sếp. Tôi là AI Advisor. Tôi có toàn quyền truy cập vào Global Data Stream (Company_Master_Logs). Sếp cần tôi phân tích dữ liệu điểm danh hay nhật ký vận hành của cơ sở nào?' }
      ]);
      const [isTyping, setIsTyping] = useState(false);

      const handleAsk = () => {
        if (!query.trim()) return;
        const userQuery = query.trim();
        setChatLog(prev => [...prev, { role: 'user', content: userQuery }]);
        setQuery('');
        setIsTyping(true);

        setTimeout(() => {
          const allData = window.DataService.fetchHistory();
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
                <div className={`max-w-[80%] p-4 rounded-2xl text-sm ${msg.role === 'ai' ? 'bg-surface-container dark:bg-[#2a2a2a] dark:text-white rounded-tl-none border border-outline-variant dark:border-gray-700' : 'bg-primary text-white rounded-tr-none shadow-md'}`}>
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
            <div className="flex gap-3 relative">
              <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAsk()} placeholder="Ví dụ: So sánh hiệu suất trực ca của Cơ sở 1 và Cơ sở 2..." className="flex-1 bg-surface-container dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-secondary text-sm dark:text-white transition-all shadow-inner" />
              <button onClick={handleAsk} disabled={!query.trim() || isTyping} className="bg-secondary hover:bg-secondary/90 disabled:opacity-50 text-white px-6 rounded-xl shadow-md shadow-secondary/20 transition-all flex items-center justify-center gap-2 font-bold">
                <span className="material-symbols-outlined">send</span> Gửi
              </button>
            </div>
          </div>
        </div>
      );
    }

    // --- ERROR BOUNDARY ---
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
      }
      render() {
        if (this.state.hasError) {
          return (
            <div className="p-6 text-error bg-error-container/20 rounded-xl border border-error/30 m-6">
              <h3 className="font-bold mb-2 flex items-center gap-2"><span className="material-symbols-outlined">warning</span>Đã xảy ra lỗi khi tải Component.</h3>
              <p className="text-sm opacity-80 font-mono">{this.state.error?.toString()}</p>
            </div>
          );
        }
        return this.props.children;
      }
    }

    // --- FACILITY DASHBOARD COMPONENT ---
    function FacilityDashboard({ user, tasks }) {
      const [stats, setStats] = useState({ open: 0, closed: 0, overdue: 0 });
      const [checkinStatus, setCheckinStatus] = useState(null);
      const [urgentTasks, setUrgentTasks] = useState([]);
      const [timeFilter, setTimeFilter] = useState('today');
      const [isLoading, setIsLoading] = useState(false);

      useEffect(() => {
        setIsLoading(true);
        const timer = setTimeout(() => {
          // Row-level security: only filter by user's facility
          const myTasks = tasks.filter(t => t.facilityId === user.facility_id || t.facility === user.facility_id);

          const now = new Date();
          let startOfFrame = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          let endOfFrame = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

          if (timeFilter === 'week') {
            const day = now.getDay() || 7; // Monday = 1, Sunday = 7
            startOfFrame = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
            endOfFrame = new Date(startOfFrame.getFullYear(), startOfFrame.getMonth(), startOfFrame.getDate() + 6, 23, 59, 59);
          } else if (timeFilter === 'month') {
            startOfFrame = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
            endOfFrame = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          }

          const startMs = startOfFrame.getTime();
          const endMs = endOfFrame.getTime();

          const getCreatedTime = (t) => {
            if (t.historyLog && t.historyLog.length > 0) {
              const match = t.historyLog[0].time.match(/(\d+):(\d+) - (\d+)\/(\d+)\/(\d+)/);
              if (match) return new Date(match[5], match[4] - 1, match[3], match[1], match[2]).getTime();
            }
            return now.getTime(); // fallback mock
          };

          const getCompletedTime = (t) => {
            if (t.completedAtReal) return new Date(t.completedAtReal).getTime();
            if (t.completedAt) return new Date(t.completedAt).getTime();
            return t.deadline ? new Date(t.deadline).getTime() : now.getTime();
          };

          const getDeadlineTime = (t) => {
            if (!t.deadline) return 0;
            const [y, m, d] = t.deadline.split('-');
            return new Date(y, m - 1, d, 23, 59, 59).getTime();
          };

          const openCount = myTasks.filter(t => {
            if (t.status === 'done' || t.status === 'revoked') return false;
            const cTime = getCreatedTime(t);
            return cTime >= startMs && cTime <= endMs;
          }).length;

          const closedCount = myTasks.filter(t => {
            if (t.status !== 'done') return false;
            const compTime = getCompletedTime(t);
            return compTime >= startMs && compTime <= endMs;
          }).length;

          const overdueCount = myTasks.filter(t => {
            const dTime = getDeadlineTime(t);
            if (dTime === 0) return false;
            if (dTime < startMs || dTime > endMs) return false;

            if (t.status !== 'done' && t.status !== 'revoked') {
              return dTime < now.getTime();
            }
            if (t.status === 'done') {
              const compTime = getCompletedTime(t);
              return compTime > dTime;
            }
            return false;
          }).length;

          setStats({ open: openCount, closed: closedCount, overdue: overdueCount });

          const todayStr = new Date().toISOString().split('T')[0];
          const urgent = myTasks.filter(t => t.status !== 'done' && t.status !== 'revoked' && (t.urgent || t.pinned || (t.deadline && t.deadline <= todayStr)));
          setUrgentTasks(urgent);

          // Attendance is always TODAY, ignoring timeframe filter
          const todayDate = new Date().toLocaleDateString('vi-VN');
          const allAttendance = window.DataService ? window.DataService.fetchHistory({ entry_type: 'Attendance' }) : [];
          const myAttendance = allAttendance.find(a => a.org_unit === user.facility_id && a.date === todayDate);

          if (myAttendance) {
            const data = myAttendance.content;
            const isNhanSuOk = data.hr_letan?.status === 'ok' && data.hr_baove?.status === 'ok';
            const isThietBiOk = data.facility_dieuhoa?.status === 'ok' && data.facility_vesinh?.status === 'ok';
            const isVesinhOk = data.facility_vesinh?.status === 'ok';
            setCheckinStatus({ status: 'Đã Check-in', nhansu: isNhanSuOk, thietbi: isThietBiOk, vesinh: isVesinhOk });
          } else {
            setCheckinStatus({ status: 'Chưa Check-in', nhansu: false, thietbi: false, vesinh: false });
          }

          setIsLoading(false);
        }, 600); // Simulate API latency

        return () => clearTimeout(timer);
      }, [tasks, user, timeFilter]);

      return (
          <div className="space-y-6 animate-fade-in">
             <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
               <div>
                 <h2 className="text-2xl font-bold text-on-surface dark:text-white">Tổng quan - {user.facility_id}</h2>
                 <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">Dữ liệu Real-time nội bộ cơ sở.</p>
               </div>
               <div className="flex items-center">
                 <div className="flex bg-surface-variant/50 dark:bg-gray-800 p-1 rounded-[14px] border border-outline-variant dark:border-gray-700 shadow-sm">
                   <button 
                     onClick={() => setTimeFilter('today')} 
                     className={`px-4 py-1.5 text-sm font-semibold rounded-xl transition-all ${timeFilter === 'today' ? 'bg-primary text-white shadow-md' : 'tex              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between transition-colors">
                   <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-blue-500">pending_actions</span> Công việc Mở</h3>
                   <div className="h-10 flex items-center">
                     {isLoading ? <span className="material-symbols-outlined animate-spin text-gray-400">sync</span> : <p className="text-4xl font-bold text-gray-800 dark:text-white animate-fade-in">{stats.open}</p>}
                   </div>
                </div>
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between transition-colors">
                   <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-green-500">check_circle</span> Công việc Hoàn thành</h3>
                   <div className="h-10 flex items-center">
                     {isLoading ? <span className="material-symbols-outlined animate-spin text-gray-400">sync</span> : <p className="text-4xl font-bold text-gray-800 dark:text-white animate-fade-in">{stats.closed}</p>}
                   </div>
                </div>
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between transition-colors">
                   <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-red-500">warning</span> Công việc Trễ hạn</h3>
                   <div className="h-10 flex items-center">
                     {isLoading ? <span className="material-symbols-outlined animate-spin text-gray-400">sync</span> : <p className="text-4xl font-bold text-red-600 dark:text-red-400 animate-fade-in">{stats.overdue}</p>}
                   </div>
                </div>�</h3>
                   <p className="text-4xl font-bold text-gray-800 dark:text-white">{stats.open}</p>
                </div>
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between">
                   <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-green-500">check_circle</span> Công việc Hoàn thành</h3>
                   <p className="text-4xl font-bold text-gray-800 dark:text-white">{stats.closed}</p>
                </div>
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between">
                   <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-red-500">warning</span> Công việc Trễ hạn</h3>
                   <p className="text-4xl font-bold text-red-600 dark:text-red-400">{stats.overdue}</p>
                </div>
                
                <div className="bg-white dark:bg-[#1e1e1e] p-5 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between">
                   <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2">
                     <span className="material-symbols-outlined text-purple-500">fact_check</span> Điểm danh hôm nay
                   </h3>
                   <div className="flex items-center gap-2 mb-3">
                     <span className={`px-2 py-1 text-xs font-bold rounded-full ${checkinStatus?.status === 'Đã Check-in' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>{checkinStatus?.status}</span>
                   </div>
                   <div className="space-y-1">
                     <div className="flex justify-between items-center text-sm">
                       <span className="text-gray-600 dark:text-gray-300">Nhân sự</span>
                       <span className="material-symbols-outlined text-[16px]" style={{color: checkinStatus?.nhansu ? '#22c55e' : '#9ca3af'}}>{checkinStatus?.nhansu ? 'check_circle' : 'cancel'}</span>
                     </div>
                     <div className="flex justify-between items-center text-sm">
                       <span className="text-gray-600 dark:text-gray-300">Thiết bị</span>
                       <span className="material-symbols-outlined text-[16px]" style={{color: checkinStatus?.thietbi ? '#22c55e' : '#9ca3af'}}>{checkinStatus?.thietbi ? 'check_circle' : 'cancel'}</span>
                     </div>
                     <div className="flex justify-between items-center text-sm">
                       <span className="text-gray-600 dark:text-gray-300">Vệ sinh</span>
                       <span className="material-symbols-outlined text-[16px]" style={{color: checkinStatus?.vesinh ? '#22c55e' : '#9ca3af'}}>{checkinStatus?.vesinh ? 'check_circle' : 'cancel'}</span>
                     </div>
                   </div>
                </div>
             </div>
             
             <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 overflow-hidden">
                <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-surface-container-low dark:bg-[#121212]">
                   <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                     <span className="material-symbols-outlined text-orange-500">local_fire_department</span> Công việc cần chú ý khẩn cấp
                   </h3>
                </div>
                <div className="p-0 max-h-96 overflow-y-auto custom-scrollbar">
                  {urgentTasks.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Tuyệt vời! Không có công việc nào khẩn cấp hoặc trễ hạn.</div>
                  ) : (
                    <ul className="divide-y divide-outline-variant dark:divide-gray-800">
                      {urgentTasks.map(t => (
                        <li key={t.id} className="p-4 hover:bg-gray-50 dark:hover:bg-[#252525] flex justify-between items-center transition-colors">
                           <div>
                              <p className="font-semibold text-gray-800 dark:text-white">{t.title}</p>
                              <p className="text-sm text-gray-500">PIC: {t.pic} | Deadline: {t.deadline}</p>
                           </div>
                           <span className="px-3 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-lg text-xs font-bold">KHẨN CẤP</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
             </div>
          </div>
       );
    }

    // --- MAIN DASHBOARD COMPONENT ---
    function MainDashboard() {
      const { user, logout } = useContext(AuthContext);
      const [viewMode, setViewMode] = useState('kanban');
      const [darkMode, setDarkMode] = useState(false);
      const [activeTab, setActiveTab] = useState(user?.role === 'FACILITY_MANAGER' ? 'dashboard' : 'tasks');
      const loadState = (key, defaultVal) => {
        try {
          const val = localStorage.getItem(key);
          return val ? JSON.parse(val) : defaultVal;
        } catch(e) {
          return defaultVal;
        }
      };

      const [tasks, setTasks] = useState(() => {
         const defaultTasks = user && user.role === 'FACILITY_MANAGER' ? INITIAL_TASKS.filter(t => t.facility === user.facility_id || t.facilityId === user.facility_id) : INITIAL_TASKS;
         return loadState('stitch_tasks', defaultTasks);
      });
      const [taskComments, setTaskComments] = useState(() => loadState('stitch_comments', {}));

      useEffect(() => {
        localStorage.setItem('stitch_tasks', JSON.stringify(tasks));
      }, [tasks]);

      useEffect(() => {
        localStorage.setItem('stitch_comments', JSON.stringify(taskComments));
      }, [taskComments]);

      useEffect(() => {
        console.log("🛠️ [SYSTEM DEMO MODE]: Hệ thống đang chạy trên LocalStorage (Giới hạn ~5MB) để phục vụ UI/UX Demo. Dữ liệu được lưu trữ cục bộ trên trình duyệt này.");
        console.log("🔌 [ROADMAP INTEGRATION]: Hạ tầng Websocket Event Listener đã sẵn sàng (Phase 2).");
        const mockSocket = { on: (event, cb) => {} };
        mockSocket.on('task_updated', (updatedTask) => {});
      }, []);

      const triggerWebhookAlert = (eventData) => {
        const payload = { timestamp: new Date().toISOString(), app_source: 'STITCH_SMART_AI_KANBAN', ...eventData };
        console.log(`%c[WEBHOOK TRIGGERED] ${payload.action}`, 'background: #222; color: #bada55; font-size: 14px; font-weight: bold;', payload);
      };

      const [globalFacilityFilter, setGlobalFacilityFilter] = useState(user.role === 'FACILITY_MANAGER' ? user.facility_id : 'ALL');
      const [archiveSearch, setArchiveSearch] = useState('');
      const [archiveDateFrom, setArchiveDateFrom] = useState('');
      const [archiveDateTo, setArchiveDateTo] = useState('');
      const [archivePic, setArchivePic] = useState('');
      const [commentText, setCommentText] = useState('');

      const handleDropTask = (taskId, newStatus) => {
        const todayStr = new Date().toISOString().split('T')[0];
        const statusNames = { todo: 'Cần làm', in_progress: 'Đang tiến hành', done: 'Hoàn thành' };
        const event = `Chuyển trạng thái: ${statusNames[newStatus] || newStatus}`;
        const now = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' - ' + new Date().toLocaleDateString('vi-VN');

        setTasks(prev => prev.map(t => {
            if (t.id === taskId) {
                let updated = { ...t, status: newStatus };
                if (newStatus === 'done' && t.status !== 'done') {
                    updated.completedAtReal = Date.now();
                    updated.completedAt = todayStr;
                } else if (newStatus !== 'done') {
                    updated.completedAt = null;
                }
                if (newStatus === 'in_progress' && t.status !== 'in_progress') {
                    updated.inProgressAt = Date.now();
                }
                updated.historyLog = [...(t.historyLog || []), { time: now, event }];
                return updated;
            }
            return t;
        }));
      };

      const handleAddComment = () => {
        if (!commentText.trim() || !selectedTask) return;
        const nowTime = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
        const nowDate = new Date().toLocaleDateString('vi-VN');
        const newComment = {
          id: generateId(),
          sender: user.name,
          role: user.role,
          text: commentText,
          time: nowTime
        };
        setTaskComments(prev => ({
          ...prev,
          [selectedTask.id]: [...(prev[selectedTask.id] || []), newComment]
        }));
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, historyLog: [...(t.historyLog || []), { time: `${nowTime} - ${nowDate}`, event: `Bình luận mới từ ${user.name}` }] } : t));
        setCommentText('');
      };

      const [facilityStatuses, setFacilityStatuses] = useState([]);
      const [isCheckinCompleted, setIsCheckinCompleted] = useState(false);

      const [selectedTask, setSelectedTask] = useState(null);
      const [showAITaskModal, setShowAITaskModal] = useState(false);
      
      const [showCreateModal, setShowCreateModal] = useState(false);
      const [createModalStatus, setCreateModalStatus] = useState('todo');
      
      const [toastMessage, setToastMessage] = useState('');

      // Dashboard time filter and stats
      const [timeFilter, setTimeFilter] = useState('week'); // 'week' | 'month'
      const [dashboardStats, setDashboardStats] = useState({ open: 0, completed: 0, overdue: 0 });
      const [isStatsLoading, setIsStatsLoading] = useState(false);

      const fetchDashboardStats = (filter) => {
        setIsStatsLoading(true);
        setTimeout(() => {
          const now = new Date('2026-05-15T19:42:42+07:00'); // System time as per metadata
          let start, end;
          if (filter === 'week') {
            const day = now.getDay() || 7; 
            start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(now.getDate() - day + 1); 
            end = new Date(start);
            end.setDate(start.getDate() + 6); 
            end.setHours(23, 59, 59, 999);
          } else {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            end.setHours(23, 59, 59, 999);
          }

          let userTasks = tasks; 
          if (user.role === 'FACILITY_MANAGER') {
            userTasks = tasks.filter(t => t.facility === user.facility_id || t.facilityId === user.facility_id);
          } else if (typeof globalFacilityFilter !== 'undefined' && globalFacilityFilter !== 'ALL') {
            userTasks = tasks.filter(t => t.facility === globalFacilityFilter || t.facilityId === globalFacilityFilter);
          }
          let open = 0, completed = 0, overdue = 0;
          
          userTasks.forEach(t => {
            const createdAt = new Date(t.createdAt || t.deadline); 
            const deadline = new Date(t.deadline);
            const isDone = t.status === 'done' || t.status === 'review';
            const compAt = t.completedAt ? new Date(t.completedAt) : null;
            
            if (createdAt >= start && createdAt <= end && !isDone) {
              open++;
            }
            if (isDone && compAt && compAt >= start && compAt <= end) {
              completed++;
            }
            if (deadline >= start && deadline <= end) {
              if (!isDone) {
                if (now > deadline) overdue++;
              } else if (compAt && compAt > deadline) {
                overdue++;
              }
            }
          });
          
          setDashboardStats({ open, completed, overdue });
          setIsStatsLoading(false);
        }, 800);
      };

      useEffect(() => {
        if (user) fetchDashboardStats(timeFilter);
      }, [user, timeFilter, tasks, globalFacilityFilter]);

      const showToast = (msg) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(''), 4000);
      };

      const handleCreateTask = (newTask) => {
        const newId = generateId();
        const now = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' - ' + new Date().toLocaleDateString('vi-VN');
        setTasks([...tasks, {
          id: newId,
          pic: user.name,
          deadline: new Date().toISOString().split('T')[0],
          urgent: false,
          facilityId: user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id,
          description: '',
          historyLog: [{ time: now, event: `Khởi tạo công việc` }],
          ...newTask
        }]);
      };

      const handleAITaskConfirm = (draftTasks) => {
        if (draftTasks && draftTasks.length > 0) {
          setTasks([...tasks, ...draftTasks]);
          showToast(`Đã tạo thành công ${draftTasks.length} công việc từ biên bản.`);
        }
      };

      useEffect(() => {
        if (user) {
          fetchFacilityStatuses();
        }
      }, [user]);

      const toggleDarkMode = () => {
        setDarkMode(!darkMode);
        if (!darkMode) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      };

      const fetchFacilityStatuses = async () => {
        try {
          const response = await fetch('http://localhost:3000/api/checkin/status', { headers: { 'x-user-role': user.role, 'x-facility-id': user.facility_id || 'ALL' } });
          if (response.ok) {
            const data = await response.json();
            setFacilityStatuses(data.data);
            if (user.role === 'FACILITY_MANAGER') {
              const myFac = data.data.find(f => f.facility_id === user.facility_id);
              if (myFac && (myFac.ca1 === 'Đã báo cáo' || myFac.ca2 === 'Đã báo cáo')) {
                setIsCheckinCompleted(true);
              } else {
                setIsCheckinCompleted(false);
              }
            }
          } else {
            setFacilityStatuses([{ facility_id: 'Cơ sở 1', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }, { facility_id: 'Cơ sở 2', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }]);
            if (user.role === 'FACILITY_MANAGER') {
              setIsCheckinCompleted(false);
            }
          }
        } catch (e) {
          setFacilityStatuses([{ facility_id: 'Cơ sở 1', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }, { facility_id: 'Cơ sở 2', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }]);
          if (user.role === 'FACILITY_MANAGER') {
            setIsCheckinCompleted(false);
          }
        }
      };

      const todayStr = new Date().toISOString().split('T')[0];
      const kanbanTasks = tasks.filter(t => t.status !== 'revoked' && (t.status !== 'done' || !t.completedAt || t.completedAt === todayStr) && (globalFacilityFilter === 'ALL' || t.facilityId === globalFacilityFilter || t.facility === globalFacilityFilter));
      const archivedTasks = tasks.filter(t => t.status === 'done' || t.status === 'revoked').filter(t => {
          if (archiveSearch && !t.title.toLowerCase().includes(archiveSearch.toLowerCase())) return false;
          if (archivePic && !t.pic.toLowerCase().includes(archivePic.toLowerCase())) return false;
          if (archiveDateFrom && t.completedAt && t.completedAt < archiveDateFrom) return false;
          if (archiveDateTo && t.completedAt && t.completedAt > archiveDateTo) return false;
          return true;
      });

      return (
        <div className={`flex h-screen w-full font-sans ${darkMode ? 'dark bg-[#121212] text-white' : 'bg-surface text-on-surface'}`}>
          <aside className="w-64 bg-surface-container-low dark:bg-[#1e1e1e] border-r border-outline-variant dark:border-gray-800 flex flex-col transition-colors">
            <div className="p-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/30">
                <span className="material-symbols-outlined">hub</span>
              </div>
              <div>
                <h1 className="font-display font-bold text-lg leading-tight tracking-tight text-primary dark:text-blue-400">TaskFlow AI</h1>
                <p className="text-xs text-on-surface-variant dark:text-gray-400">Trung tâm Điều khiển</p>
              </div>
            </div>

            <nav className="flex-1 px-4 space-y-1">
              {user.role === 'FACILITY_MANAGER' && (
                <>
                  <NavItem icon="dashboard" label="Tổng quan" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
                  <NavItem icon="assignment" label="Công việc" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
                  <NavItem icon="fact_check" label="Điểm danh" active={activeTab === 'checkin'} onClick={() => setActiveTab('checkin')} />
                </>
              )}
              {user.role !== 'FACILITY_MANAGER' && (
                <NavItem icon="assignment" label="Công việc" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
              )}
              {user.role === 'SUPER_ADMIN' && (
                <>
                  <NavItem icon="analytics" label="Báo cáo AI" active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} />
                  <NavItem icon="corporate_fare" label="Đa cơ sở" active={activeTab === 'facilities'} onClick={() => setActiveTab('facilities')} />
                </>
              )}
            </nav>

            <div className="p-4 border-t border-outline-variant dark:border-gray-800 space-y-2">
              <div className="px-3 py-2 flex items-center gap-3 bg-surface dark:bg-gray-800 rounded-lg border border-outline-variant dark:border-gray-700 shadow-sm mb-4">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-semibold truncate dark:text-white">{user.name}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{user.role}</p>
                </div>
              </div>
              <button onClick={logout} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error-container dark:hover:bg-red-900/30 rounded-lg transition-colors">
                <span className="material-symbols-outlined">logout</span> Đăng xuất
              </button>
            </div>
          </aside>

          <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative transition-colors">
            <header className="h-16 border-b border-outline-variant dark:border-gray-800 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10 transition-colors">
              <div className="flex items-center gap-4 flex-1">
                <div className="relative w-96 hidden md:block">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">search</span>
                  <input type="text" placeholder="Tìm kiếm task, cơ sở, PIC..." className="w-full bg-surface-container dark:bg-gray-800 border-transparent focus:border-primary focus:ring-1 focus:ring-primary rounded-full pl-10 pr-4 py-2 text-sm outline-none transition-all dark:text-white" />
                </div>
                {['SUPER_ADMIN', 'GENERAL_MANAGER', 'ADMIN'].includes(user.role) && (
                  <select 
                    value={globalFacilityFilter} 
                    onChange={(e) => setGlobalFacilityFilter(e.target.value)}
                    className="bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 text-sm rounded-lg px-3 py-2 outline-none dark:text-white font-medium shadow-sm transition-colors cursor-pointer hover:border-gray-400 dark:hover:border-gray-600"
                  >
                    <option value="ALL">🌐 Tất cả cơ sở</option>
                    <option value="Cơ sở 1">Cơ sở 1</option>
                    <option value="Cơ sở 2">Cơ sở 2</option>
                    <option value="Toàn hệ thống">Toàn hệ thống</option>
                    <option value="HQ">HQ</option>
                  </select>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={toggleDarkMode} className="p-2 rounded-full hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-500 transition-colors">
                  <span className="material-symbols-outlined">{darkMode ? 'light_mode' : 'dark_mode'}</span>
                </button>
                <button className="p-2 rounded-full hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-500 relative transition-colors">
                  <span className="material-symbols-outlined">notifications</span>
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-error rounded-full border-2 border-white dark:border-[#121212]"></span>
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-6 bg-surface-container-low dark:bg-[#181818] transition-colors custom-scrollbar">
              <div className="max-w-6xl mx-auto">
                {activeTab === 'checkin' && user.role === 'FACILITY_MANAGER' ? (
                  <ErrorBoundary>
                    <DailyCheckin 
                      showToast={showToast} 
                      onCheckinSuccess={() => {
                        setIsCheckinCompleted(true);
                        fetchFacilityStatuses();
                        setActiveTab('tasks');
                      }} 
                    />
                  </ErrorBoundary>
                ) : activeTab === 'reports' && user.role === 'SUPER_ADMIN' ? (
                  <ErrorBoundary>
                    <AIAdvisor />
                  </ErrorBoundary>
                ) : activeTab === 'dashboard' && user.role === 'FACILITY_MANAGER' ? (
                  <ErrorBoundary>
                     <FacilityDashboard user={user} tasks={tasks} />
                  </ErrorBoundary>
                ) : (
                  <>
                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                      <div>
                        <h2 className="text-2xl font-bold text-on-surface dark:text-white">
                          {user.role === 'SUPER_ADMIN' ? 'Tổng quan Toàn chuỗi' : `Dashboard - ${user.facility_id}`}
                        </h2>
                        <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">
                          {user.role === 'SUPER_ADMIN' ? 'Quản lý và điều phối task trên toàn hệ thống.' : 'Quản lý công việc nội bộ cơ sở.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="bg-surface dark:bg-gray-800 rounded-lg p-1 border border-outline-variant dark:border-gray-700 flex shadow-sm">
                          <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm text-primary dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                            <span className="material-symbols-outlined text-[18px]">view_list</span> Danh sách
                          </button>
                          <button onClick={() => setViewMode('kanban')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${viewMode === 'kanban' ? 'bg-white dark:bg-gray-700 shadow-sm text-primary dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                            <span className="material-symbols-outlined text-[18px]">view_kanban</span> Bảng
                          </button>
                          <button onClick={() => setViewMode('archive')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${viewMode === 'archive' ? 'bg-white dark:bg-gray-700 shadow-sm text-primary dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                            <span className="material-symbols-outlined text-[18px]">history</span> Lịch sử
                          </button>
                        </div>
                        <button onClick={() => setShowCreateModal(true)} className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-md shadow-primary/20 transition-all">
                          <span className="material-symbols-outlined text-[18px]">add</span> Mới
                        </button>
                      </div>
                    </div>

                    {/* Segmented Control: Time Filter */}
                    <div className="flex items-center bg-surface-container-high dark:bg-[#252525] rounded-lg p-1 w-fit mb-6 shadow-inner border border-outline-variant dark:border-gray-800">
                      <button
                        onClick={() => setTimeFilter('week')}
                        className={`px-5 py-1.5 text-sm font-medium rounded-md transition-all duration-300 ${
                          timeFilter === 'week'
                            ? 'bg-primary text-white shadow-md'
                            : 'text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-white'
                        }`}
                      >
                        Tuần này
                      </button>
                      <button
                        onClick={() => setTimeFilter('month')}
                        className={`px-5 py-1.5 text-sm font-medium rounded-md transition-all duration-300 ${
                          timeFilter === 'month'
                            ? 'bg-primary text-white shadow-md'
                            : 'text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-white'
                        }`}
                      >
                        Tháng này
                      </button>
                    </div>

                    {/* 3 Widgets Công việc */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                      <div className="p-5 bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm flex flex-col justify-between group hover:border-primary/30 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                              <span className="material-symbols-outlined text-[20px]">folder_open</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Công việc Mở</span>
                          </div>
                        </div>
                        <div>
                          {isStatsLoading ? (
                            <div className="animate-pulse h-10 w-16 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
                          ) : (
                            <h3 className="text-4xl font-bold text-on-surface dark:text-white">{dashboardStats.open}</h3>
                          )}
                        </div>
                      </div>

                      <div className="p-5 bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm flex flex-col justify-between group hover:border-success/30 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center text-success">
                              <span className="material-symbols-outlined text-[20px]">task_alt</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Hoàn thành</span>
                          </div>
                        </div>
                        <div>
                          {isStatsLoading ? (
                            <div className="animate-pulse h-10 w-16 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
                          ) : (
                            <h3 className="text-4xl font-bold text-on-surface dark:text-white">{dashboardStats.completed}</h3>
                          )}
                        </div>
                      </div>

                      <div className="p-5 bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm flex flex-col justify-between group hover:border-error/30 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-error/10 flex items-center justify-center text-error">
                              <span className="material-symbols-outlined text-[20px]">assignment_late</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Trễ hạn</span>
                          </div>
                        </div>
                        <div>
                          {isStatsLoading ? (
                            <div className="animate-pulse h-10 w-16 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
                          ) : (
                            <h3 className="text-4xl font-bold text-on-surface dark:text-white">{dashboardStats.overdue}</h3>
                          )}
                        </div>
                      </div>
                    </div>

                    {viewMode === 'kanban' ? (
                      <GlobalKanbanBoard>
                        <GlobalKanbanColumn title="Cần làm" status="todo" tasks={kanbanTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'todo'})} onDropTask={handleDropTask} taskComments={taskComments} onOpenAITaskModal={() => setShowAITaskModal(true)} />
                        <GlobalKanbanColumn title="Đang tiến hành" status="in_progress" tasks={kanbanTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'in_progress'})} onDropTask={handleDropTask} taskComments={taskComments} />
                        <GlobalKanbanColumn title="Hoàn thành" status="done" tasks={kanbanTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'done'})} onDropTask={handleDropTask} taskComments={taskComments} />
                      </GlobalKanbanBoard>
                    ) : viewMode === 'archive' ? (
                      <div className="flex flex-col gap-4">
                        <div className="bg-white dark:bg-[#1e1e1e] p-4 rounded-xl border border-outline-variant dark:border-gray-800 flex flex-wrap gap-3 items-center">
                           <div className="flex-1 min-w-[200px] relative">
                             <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">search</span>
                             <input type="text" placeholder="Tìm tên công việc..." value={archiveSearch} onChange={e => setArchiveSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white" />
                           </div>
                           <input type="text" placeholder="Người phụ trách (PIC)" value={archivePic} onChange={e => setArchivePic(e.target.value)} className="px-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white min-w-[150px]" />
                           <div className="flex items-center gap-2">
                             <span className="text-sm text-gray-500">Từ:</span>
                             <input type="date" value={archiveDateFrom} onChange={e => setArchiveDateFrom(e.target.value)} className="px-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white" />
                             <span className="text-sm text-gray-500">Đến:</span>
                             <input type="date" value={archiveDateTo} onChange={e => setArchiveDateTo(e.target.value)} className="px-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white" />
                           </div>
                        </div>

                        <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 overflow-hidden">
                          <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400 border-b border-outline-variant dark:border-gray-700">
                              <tr>
                                <th className="px-6 py-4">Tên công việc</th>
                                <th className="px-6 py-4">Cơ sở</th>
                                <th className="px-6 py-4">Người phụ trách</th>
                                <th className="px-6 py-4">Ngày hoàn thành</th>
                                <th className="px-6 py-4 text-right">Chi tiết</th>
                              </tr>
                            </thead>
                            <tbody>
                              {archivedTasks.map(t => (
                                <tr key={t.id} className="border-b border-outline-variant dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors" onClick={() => setSelectedTask(t)}>
                                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{t.title}</td>
                                  <td className="px-6 py-4"><span className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">{t.facility}</span></td>
                                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{t.pic}</td>
                                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 font-mono">{t.completedAt || 'Legacy'}</td>
                                  <td className="px-6 py-4 text-right">
                                    <button className="text-primary hover:underline font-medium text-xs flex items-center justify-end gap-1">
                                       Xem <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {archivedTasks.length === 0 && (
                                <tr>
                                  <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">inbox</span>
                                    <p>Không tìm thấy dữ liệu lịch sử phù hợp.</p>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 overflow-hidden">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400">
                            <tr>
                              <th className="px-6 py-4">Task</th>
                              <th className="px-6 py-4">PIC</th>
                              <th className="px-6 py-4">Deadline</th>
                              <th className="px-6 py-4">Trạng thái</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kanbanTasks.map(task => (
                              <tr key={task.id} onClick={() => setSelectedTask(task)} className="cursor-pointer border-b border-outline-variant dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <td className="px-6 py-4">
                                  <div className="font-medium text-on-surface dark:text-white">{task.title}</div>
                                  <div className="text-xs text-gray-500">{task.desc}</div>
                                </td>
                                <td className="px-6 py-4">{task.pic}</td>
                                <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{task.deadline}</td>
                                <td className="px-6 py-4"><StatusBadge status={task.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </main>

          {/* Modals & Overlays */}
          {selectedTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row border border-outline-variant dark:border-gray-800">
                <div className="flex-1 p-6 border-r border-outline-variant dark:border-gray-800 overflow-y-auto">
                  <div className="flex justify-between items-start mb-4 pr-8">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getStatusConfig(selectedTask.status).color}`}>
                      <span className="material-symbols-outlined text-[14px]">{getStatusConfig(selectedTask.status).icon}</span>
                      {getStatusConfig(selectedTask.status).label}
                    </span>
                    <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 md:hidden">
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                  <div className="flex items-start gap-3 mb-2">
                    <h2 className="text-xl font-bold text-on-surface dark:text-white flex-1">{selectedTask.title}</h2>
                    {['SUPER_ADMIN', 'GENERAL_MANAGER', 'DEPARTMENT_HEAD', 'FACILITY_MANAGER'].includes(user.role) && viewMode !== 'archive' && (
                      <button 
                        onClick={() => {
                          const isPinned = !selectedTask.pinned;
                          setSelectedTask({ ...selectedTask, pinned: isPinned });
                          setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, pinned: isPinned } : t));
                          showToast(isPinned ? `📌 Đã ghim tác vụ: ${selectedTask.title}` : `Bỏ ghim tác vụ: ${selectedTask.title}`);
                          if (isPinned) triggerWebhookAlert({ action: 'PIN_TASK', task_name: selectedTask.title, facility: selectedTask.facilityId || selectedTask.facility, pic: selectedTask.pic, status: 'KHẨN CẤP' });
                        }}
                        className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center shrink-0 ${selectedTask.pinned ? 'bg-orange-100 border-orange-300 text-orange-600 dark:bg-orange-900/30 dark:border-orange-800/50 dark:text-orange-400' : 'bg-surface-container-low border-outline-variant text-gray-400 hover:bg-gray-100 dark:bg-[#252525] dark:border-gray-700 dark:hover:bg-gray-800'}`}
                        title={selectedTask.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
                      >
                        <span className="material-symbols-outlined text-[20px]">{selectedTask.pinned ? 'keep' : 'push_pin'}</span>
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{selectedTask.description || selectedTask.desc}</p>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-surface-container-low dark:bg-[#252525] rounded-xl">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Người phụ trách (PIC)</span>
                      <span className="text-sm font-bold dark:text-white">{selectedTask.pic}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-surface-container-low dark:bg-[#252525] rounded-xl">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Cơ sở</span>
                      <span className="text-sm font-bold dark:text-white">{selectedTask.facility}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-error-container/50 dark:bg-red-900/10 rounded-xl border border-error/20">
                      <span className="text-sm font-medium text-error">Hạn chót</span>
                      <input 
                        type="date" 
                        value={selectedTask.deadline || ''}
                        disabled={viewMode === 'archive'}
                        onChange={(e) => {
                          const newDeadline = e.target.value;
                          const todayStr = new Date().toISOString().split('T')[0];
                          const now = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' - ' + new Date().toLocaleDateString('vi-VN');
                          setSelectedTask({ ...selectedTask, deadline: newDeadline, historyLog: [...(selectedTask.historyLog || []), { time: now, event: `Thay đổi hạn chót: ${newDeadline}` }] });
                          setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, deadline: newDeadline, historyLog: [...(t.historyLog || []), { time: now, event: `Thay đổi hạn chót: ${newDeadline}` }] } : t));
                          if (newDeadline < todayStr && (!selectedTask.deadline || selectedTask.deadline >= todayStr)) {
                             triggerWebhookAlert({ action: 'OVERDUE_TASK', task_name: selectedTask.title, facility: selectedTask.facilityId || selectedTask.facility, pic: selectedTask.pic, status: 'TRỄ HẠN' });
                          }
                        }}
                        className={`text-sm font-bold text-error bg-transparent outline-none cursor-pointer ${viewMode === 'archive' ? 'opacity-70 cursor-not-allowed' : 'hover:bg-error/10'} rounded px-2 py-1 transition-colors`}
                      />
                    </div>
                  </div>
                  
                  {['SUPER_ADMIN', 'GENERAL_MANAGER', 'ADMIN'].includes(user.role) && selectedTask.inProgressAt && selectedTask.status === 'in_progress' && (
                    <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800/30 rounded-xl">
                      <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">⏱️ Đã ngâm ở cột Đang tiến hành: {Math.floor((Date.now() - selectedTask.inProgressAt) / 3600000)} giờ {Math.floor(((Date.now() - selectedTask.inProgressAt) % 3600000) / 60000)} phút</p>
                    </div>
                  )}
                  {['SUPER_ADMIN', 'GENERAL_MANAGER', 'ADMIN'].includes(user.role) && selectedTask.inProgressAt && selectedTask.completedAtReal && (
                    <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30 rounded-xl">
                      <p className="text-xs text-green-600 dark:text-green-400 font-medium">⏱️ Tổng thời gian thi công (Đang làm &rarr; Hoàn thành): {Math.floor((selectedTask.completedAtReal - selectedTask.inProgressAt) / 3600000)} giờ {Math.floor(((selectedTask.completedAtReal - selectedTask.inProgressAt) % 3600000) / 60000)} phút</p>
                    </div>
                  )}

                  {viewMode !== 'archive' && (
                  <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-800">
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Thao tác nhanh</h3>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => {
                            if(selectedTask.status !== 'todo') return;
                            handleDropTask(selectedTask.id, 'in_progress');
                            setSelectedTask({...selectedTask, status: 'in_progress'});
                        }} 
                        disabled={selectedTask.status !== 'todo'}
                        className={`flex-1 font-medium py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 ${selectedTask.status === 'todo' ? 'bg-primary hover:bg-primary/90 text-white shadow-primary/20' : 'bg-surface-variant text-gray-400 cursor-not-allowed opacity-50 dark:bg-gray-800 dark:text-gray-500 border border-transparent dark:border-gray-700'}`}
                      >
                        <span className="material-symbols-outlined text-[18px]">rocket_launch</span> Đang làm
                      </button>

                      <button 
                        onClick={() => {
                            if(selectedTask.status !== 'in_progress') return;
                            handleDropTask(selectedTask.id, 'done');
                            setSelectedTask({...selectedTask, status: 'done'});
                        }} 
                        disabled={selectedTask.status !== 'in_progress'}
                        className={`flex-1 font-medium py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 ${selectedTask.status === 'in_progress' ? 'bg-success hover:bg-success/90 text-white shadow-success/20' : 'bg-surface-variant text-gray-400 cursor-not-allowed opacity-50 dark:bg-gray-800 dark:text-gray-500 border border-transparent dark:border-gray-700'}`}
                      >
                        <span className="material-symbols-outlined text-[18px]">check_circle</span> Hoàn thành
                      </button>
                    </div>

                    {['SUPER_ADMIN', 'GENERAL_MANAGER', 'ADMIN'].includes(user.role) && (
                      <div className="mt-3 flex">
                        <button 
                          onClick={() => {
                            if (window.confirm("Bạn có chắc chắn muốn thu hồi công việc này? Hành động này sẽ chuyển tác vụ vào mục Lịch sử với trạng thái THU HỒI")) {
                              const now = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' - ' + new Date().toLocaleDateString('vi-VN');
                              setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, status: 'revoked', completedAt: new Date().toISOString().split('T')[0], historyLog: [...(t.historyLog || []), { time: now, event: 'THU HỒI CÔNG VIỆC' }] } : t));
                              showToast(`🚨 Task "${selectedTask.title}" đã bị thu hồi bởi Sếp. Vui lòng dừng công việc!`);
                              triggerWebhookAlert({ action: 'REVOKE_TASK', task_name: selectedTask.title, facility: selectedTask.facilityId || selectedTask.facility, pic: selectedTask.pic, status: 'THU HỒI' });
                              setSelectedTask(null);
                            }
                          }}
                          className="w-full font-medium py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 bg-gray-200 text-red-600 dark:bg-red-900/20 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-800/30"
                        >
                          <span className="material-symbols-outlined text-[18px]">block</span> Thu hồi công việc
                        </button>
                      </div>
                    )}
                  </div>
                  )}

                  <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-800">
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">history</span>
                      Lịch sử hoạt động (AI-Ready Log)
                    </h3>
                    <div className="bg-surface-container-low dark:bg-[#252525] rounded-xl p-4 max-h-48 overflow-y-auto custom-scrollbar">
                      <div className="relative border-l-2 border-outline-variant dark:border-gray-700 ml-3 space-y-4">
                        {(selectedTask.historyLog || [{time: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' - ' + new Date().toLocaleDateString('vi-VN'), event: 'Hệ thống tự động khởi tạo công việc'}]).map((log, idx) => (
                          <div key={idx} className="relative pl-5">
                            <span className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-white dark:border-[#252525]"></span>
                            <div className="text-xs text-gray-400 mb-0.5">{log.time}</div>
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{log.event}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="w-full md:w-96 flex flex-col bg-surface-container-lowest dark:bg-[#1a1a1a]">
                  <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-white dark:bg-[#1e1e1e]">
                    <h3 className="font-bold text-sm flex items-center gap-2 dark:text-white">
                      <span className="material-symbols-outlined text-primary">forum</span>
                      Thảo luận Task (@)
                    </h3>
                    <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hidden md:block">
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 custom-scrollbar">
                    {(!taskComments[selectedTask.id] || taskComments[selectedTask.id].length === 0) ? (
                      <div className="text-center text-gray-500 dark:text-gray-400 text-sm mt-10">Chưa có bình luận nào. Gõ @ để tag tên thành viên.</div>
                    ) : (
                      taskComments[selectedTask.id].map(comment => (
                        <div key={comment.id} className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">{comment.sender.charAt(0)}</div>
                          <div className="bg-surface-container dark:bg-[#2a2a2a] p-3 rounded-2xl rounded-tl-none text-sm dark:text-gray-200">
                            <div className="flex justify-between items-center gap-4 mb-1">
                              <span className="text-primary dark:text-blue-400 font-bold text-[11px] block">{comment.sender}</span>
                              <span className="text-[10px] text-gray-400">{comment.time}</span>
                            </div>
                            <span>{comment.text}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {viewMode !== 'archive' ? (
                  <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-white dark:bg-[#1e1e1e]">
                    <div className="relative flex items-center gap-2">
                      <input 
                        type="text" 
                        placeholder="Gõ @ để tag tên..." 
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                        className="w-full pl-4 pr-10 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none dark:text-white" 
                      />
                      <button onClick={handleAddComment} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:text-primary/80 p-1 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[20px]">send</span>
                      </button>
                    </div>
                  </div>
                  ) : (
                  <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-white dark:bg-[#1e1e1e] text-center text-xs text-gray-500">
                    Chế độ xem lịch sử (Read-only)
                  </div>
                  )}
                </div>
              </div>
            </div>
          )}


          {showCreateModal && (
            <TaskCreationModal onClose={() => setShowCreateModal(false)} onSave={handleCreateTask} defaultStatus={createModalStatus} user={user} />
          )}

          {showAITaskModal && (
            <AITaskModal onClose={() => setShowAITaskModal(false)} onConfirm={handleAITaskConfirm} user={user} />
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div className="fixed bottom-6 right-6 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-fade-in z-50">
              <span className="material-symbols-outlined text-success dark:text-green-600">check_circle</span>
              <span className="text-sm font-medium">{toastMessage}</span>
            </div>
          )}
        </div>
      );
    }

    function AppContainer() {
      const [user, setUser] = useState(null);
      const [loading, setLoading] = useState(true);

      useEffect(() => {
        const authData = localStorage.getItem('taskflow_auth');
        if (authData) { try { const parsed = JSON.parse(authData); if (parsed && parsed.user) setUser(parsed.user); } catch (e) { } }
        setLoading(false);
      }, []);

      const login = (userData, token) => { localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: userData })); setUser(userData); };
      const logout = () => { localStorage.removeItem('taskflow_auth'); setUser(null); };

      if (loading) return null;
      return <AuthContext.Provider value={{ user, login, logout }}>{user ? <MainDashboard /> : <Login />}</AuthContext.Provider>;
    }

    function NavItem({ icon, label, active, onClick }) {
      return (
        <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${active ? 'bg-primary/10 dark:bg-primary/20 text-primary dark:text-blue-400 font-semibold' : 'text-on-surface-variant dark:text-gray-400 hover:bg-surface-variant dark:hover:bg-gray-800 hover:text-on-surface dark:hover:text-gray-200'}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
          {label}
        </button>
      );
    }

    const getStatusConfig = (status) => {
      switch (status) {
        case 'todo': return { label: 'Cần làm', color: 'bg-surface-variant text-on-surface-variant border-outline-variant dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700', icon: 'pending' };
        case 'in_progress': return { label: 'Đang tiến hành', color: 'bg-primary/10 text-primary border-primary/20 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50', icon: 'sync' };
        case 'review': return { label: 'Nghiệm thu', color: 'bg-secondary/10 text-secondary border-secondary/20 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800/50', icon: 'assignment_turned_in' };
        case 'done': return { label: 'Hoàn thành', color: 'bg-success/10 text-success border-success/20 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50', icon: 'check_circle' };
        case 'revoked': return { label: 'THU HỒI', color: 'bg-gray-200 text-red-600 border-gray-400 dark:bg-[#252525] dark:text-red-500 dark:border-gray-600 font-bold', icon: 'block' };
        default: return { label: 'Unknown', color: 'bg-gray-100 text-gray-500', icon: 'help' };
      }
    };

    function StatusBadge({ status }) {
      const config = getStatusConfig(status);
      return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`}>{config.label}</span>;
    }
    // --- GLOBAL UI COMPONENTS ---
    function GlobalKanbanBoard({ children }) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch h-[calc(100vh-160px)]">
          {children}
        </div>
      );
    }

    function GlobalKanbanColumn({ title, status, tasks, setSelectedTask, onOpenCreateModal, onQuickAdd, onDropTask, taskComments, onOpenAITaskModal }) {
      const columnTasks = tasks.filter(t => t.status === status);
      const [showQuickAdd, setShowQuickAdd] = useState(false);
      const [quickTitle, setQuickTitle] = useState('');
      const inputRef = React.useRef(null);

      const sortedColumnTasks = [...columnTasks].sort((a, b) => {
        const todayStr = new Date().toISOString().split('T')[0];
        const getPriority = (task) => {
            if (task.pinned) return 0;
            if (!task.deadline) return 4;
            if (task.deadline < todayStr) return 1;
            if (task.deadline === todayStr) return 2;
            return 3;
        };
        const pA = getPriority(a);
        const pB = getPriority(b);
        if (pA !== pB) return pA - pB;
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
        return 0;
      });

      React.useEffect(() => {
        if (showQuickAdd && inputRef.current) inputRef.current.focus();
      }, [showQuickAdd]);

      const handleQuickSubmit = () => {
        if (quickTitle.trim()) {
          onQuickAdd({ title: quickTitle.trim(), status, desc: '' });
          setQuickTitle('');
          setShowQuickAdd(false);
        }
      };

      const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleQuickSubmit();
        else if (e.key === 'Escape') { setShowQuickAdd(false); setQuickTitle(''); }
      };

      const getDeadlineBadge = (deadline) => {
        if (!deadline) return null;
        const todayStr = new Date().toISOString().split('T')[0];
        if (deadline < todayStr) return <span className="bg-error/10 text-error px-2 py-0.5 rounded text-[10px] font-bold border border-error/20">Đã trễ</span>;
        if (deadline === todayStr) return <span className="bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-500/20">Sắp trễ</span>;
        return null;
      };

      return (
        <div 
            className="flex flex-col bg-surface-container dark:bg-[#1a1a1a] rounded-xl border border-outline-variant dark:border-gray-800/50 p-4 h-full global-kanban-column"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                e.preventDefault();
                const taskId = e.dataTransfer.getData('taskId');
                if (taskId && onDropTask) onDropTask(parseInt(taskId), status);
            }}
        >
          <div className="flex flex-col mb-4 shrink-0 gap-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                {title} <span className="bg-white dark:bg-gray-800 border border-outline-variant dark:border-gray-700 text-gray-500 px-2 py-0.5 rounded-full text-xs">{columnTasks.length}</span>
              </h3>
            </div>
            {status === 'todo' && onOpenAITaskModal && (
              <button onClick={onOpenAITaskModal} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-secondary/10 to-purple-500/10 hover:from-secondary/20 hover:to-purple-500/20 text-secondary dark:text-purple-400 border border-secondary/30 dark:border-purple-500/30 rounded-xl py-2 px-4 text-sm font-bold transition-all shadow-sm">
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span> Tạo nhanh bằng AI
              </button>
            )}
          </div>
          
          <div className="flex flex-col gap-3 overflow-y-auto custom-scrollbar flex-1 pb-2 pr-1">
            {sortedColumnTasks.map(task => (
              <div 
                  key={task.id} 
                  draggable 
                  onDragStart={(e) => e.dataTransfer.setData('taskId', task.id.toString())}
                  onClick={() => setSelectedTask(task)} 
                  className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-outline-variant dark:border-gray-700 hover:shadow-md transition-shadow cursor-pointer group shrink-0"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary dark:text-blue-400 bg-primary/10 dark:bg-primary/20 px-2 py-1 rounded-md">{task.facilityId || task.facility}</span>
                  <div className="flex items-center gap-1">
                    {task.pinned && <span className="material-symbols-outlined text-orange-500 text-[16px]" title="Đã ghim">push_pin</span>}
                    {getDeadlineBadge(task.deadline)}
                    {task.aiPinged && <span className="material-symbols-outlined text-secondary text-[16px] animate-pulse" title="AI đã nhắc việc">notifications_active</span>}
                    {task.urgent && <span className="material-symbols-outlined text-error text-[16px]" title="Khẩn cấp">error</span>}
                  </div>
                </div>
                <h4 className="text-sm font-semibold text-on-surface dark:text-gray-100 mb-2 leading-snug">{task.title}</h4>
                <div className="flex items-center justify-between mt-4 border-t border-outline-variant dark:border-gray-700/50 pt-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300" title={task.pic}>
                      {task.pic.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{task.pic}</span>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400 hover:text-secondary transition-colors" title="Thảo luận (Task-Chat)">
                    <span className="material-symbols-outlined text-[16px]">forum</span>
                    <span className="text-xs">{(taskComments && taskComments[task.id] && taskComments[task.id].length) || 0}</span>
                  </div>
                </div>
              </div>
            ))}
            
            {columnTasks.length === 0 && !showQuickAdd && <div className="text-center p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-gray-400 text-xs mt-2 shrink-0">Trống</div>}
            
            {showQuickAdd && status !== 'done' && (
              <div className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-primary dark:border-blue-500 mt-2 shrink-0">
                <input ref={inputRef} type="text" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => quickTitle.trim() ? handleQuickSubmit() : setShowQuickAdd(false)} placeholder="Nhập tiêu đề (Enter để lưu)..." className="w-full text-sm outline-none bg-transparent dark:text-white" />
              </div>
            )}
          </div>

          {status !== 'done' && (
            <div className="mt-2 shrink-0 pt-3 border-t border-outline-variant dark:border-gray-800/50">
              {!showQuickAdd && (
                <div className="flex gap-2">
                  <button onClick={() => setShowQuickAdd(true)} className="flex-1 py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700" title="Quick Add">
                    <span className="material-symbols-outlined text-[18px]">bolt</span>
                  </button>
                  <button onClick={() => onOpenCreateModal(status)} className="flex-[3] py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700">
                    <span className="material-symbols-outlined text-[18px] mr-1">add</span> Thêm
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<AppContainer />);
  
