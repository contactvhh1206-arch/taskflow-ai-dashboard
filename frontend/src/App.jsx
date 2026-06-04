import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import axiosClient from './api/axiosClient.js';
import Login from './components/Login.jsx';
import DailyCheckin from './components/DailyCheckin.jsx';
import AITaskModal from './components/AITaskModal.jsx';
import AIAdvisor from './components/AIAdvisor.jsx';
import ChangePasswordModal from './components/ChangePasswordModal.jsx';
import AdminConfigPanel from './components/AdminConfigPanel.jsx';
import ApiConfigPanel from './components/ApiConfigPanel.jsx';
import AIUsageLogs from './components/AIUsageLogs.jsx';
import RAGManagerPanel from './components/RAGManagerPanel.jsx';
import FacilityDashboard from './components/FacilityDashboard.jsx';

import RevenueOverviewDashboard from './components/RevenueOverviewDashboard.jsx';
import DailyRevenueReport from './components/DailyRevenueReport.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import RevenueLog from './components/RevenueLog.jsx';
import KPISettings from './components/KPISettings.jsx';
import ArchivedFacilitiesDashboard from './components/ArchivedFacilitiesDashboard.jsx';
import TaskHistory from './components/TaskHistory.jsx';
import { AIChatBox } from './components/AIChatBox.tsx';
// --- GLOBAL FETCH INTERCEPTOR (VÁ BỞI HUBDB 333) ---
// File: src/App.jsx

let isLoggingOut = false; // Cờ khóa: Ngăn chặn bão 401 gọi hàm liên tục (Race Condition)

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  
  // 1. Xử lý kẹp Token vào Request
  if (typeof resource === 'string' && resource.includes('/api/')) {
    let token = localStorage.getItem('token') || localStorage.getItem('taskflow_token');
    if (!token || token === 'undefined' || token === 'null') {
      try {
        const authData = JSON.parse(localStorage.getItem('taskflow_auth') || '{}');
        if (authData.token) token = authData.token;
      } catch(e) {}
    }
    
    if (token && token !== 'undefined' && token !== 'null') {
      config = config || {};
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${token}`
      };
      args = [resource, config];
    }
  }
  
  // 2. Thực thi Fetch và Đánh chặn Response
  return originalFetch(...args).then(res => {
    // Nếu bị lỗi 401 Unauthorized từ Server
    if (res.status === 401) {
      
      // BỎ QUA NẾU: Đang ở trang login (tránh lặp vô tận ở màn login) 
      // HOẶC hệ thống đang trong tiến trình đá user ra ngoài (isLoggingOut = true)
      if (window.location.pathname === '/login' || isLoggingOut) {
        return res;
      }

      // Kích hoạt cờ khóa an toàn
      isLoggingOut = true;
      
      // Dọn dẹp sạch sẽ toàn bộ Cache
      localStorage.removeItem('token');
      localStorage.removeItem('taskflow_token');
      localStorage.removeItem('taskflow_auth');
      localStorage.removeItem('user'); 
      
      // [QUAN TRỌNG] ĐÁ THẲNG VỀ /login thay vì reload tại chỗ
      window.location.href = '/login'; 
    }
    return res;
  });
};
// ---------------------------------

const getStatusConfig = (status) => {
    switch (status) {
      case 'todo': return { label: 'Cần làm', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', icon: 'radio_button_unchecked' };
      case 'in_progress': return { label: 'Đang tiến hành', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: 'pending' };
      case 'review': return { label: 'Nghiệm thu', color: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: 'rate_review' };
      case 'done': return { label: 'Hoàn thành', color: 'bg-success-container text-success dark:bg-green-900/30 dark:text-green-400', icon: 'check_circle' };
      default: return { label: 'Chưa rõ', color: 'bg-gray-100 text-gray-700', icon: 'help' };
    }
  };

// 1. Khởi tạo Auth Context
import { AuthContext } from './contexts/AuthContext.jsx';

const INITIAL_TASKS = [
  { id: 1, title: 'Bảo trì máy lạnh cơ sở 1', status: 'todo', facility: 'Cơ sở 1', pic: 'Quản lý Cơ sở 1', deadline: '2026-05-14', urgent: true, createdAt: '2026-05-13' },
  { id: 2, title: 'Lên chiến dịch Flash Sale', status: 'in_progress', facility: 'Toàn hệ thống', pic: 'Trần Thị B', deadline: '2026-05-16', urgent: false, createdAt: '2026-05-14' },
  { id: 3, title: 'Nghiệm thu KPI tháng 4', status: 'review', facility: 'Cơ sở 2', pic: 'Lê Văn C', deadline: '2026-05-14', urgent: true, createdAt: '2026-05-01', completedAt: '2026-05-15' },
  { id: 4, title: 'Cập nhật tài liệu onboarding', status: 'done', facility: 'HQ', pic: 'Phạm D', deadline: '2026-05-10', urgent: false, createdAt: '2026-05-05', completedAt: '2026-05-09' },
  { id: 5, title: 'Task tháng trước', status: 'done', facility: 'Cơ sở 1', pic: 'Quản lý Cơ sở 1', deadline: '2026-04-20', urgent: false, createdAt: '2026-04-10', completedAt: '2026-04-19' }
];

const AI_INSIGHTS = [
  { id: 1, title: 'Cảnh báo Tiến độ', desc: 'Task "Nghiệm thu KPI tháng 4" sắp trễ hạn. Đề xuất gửi AI Ping đôn đốc.', type: 'warning' },
  { id: 2, title: 'Tối ưu Nguồn lực', desc: 'Cơ sở 1 đang quá tải 20% so với định mức. Có thể điều phối nhân sự từ Cơ sở 2 sang hỗ trợ.', type: 'info' },
];

function TaskCreationModal({ onClose, onSave, defaultStatus, user }) {
  const isLocalLocked = ['FACILITY_MANAGER', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'ADMIN'].includes(user.role);
  const activeFacilities = JSON.parse(localStorage.getItem("taskflow_facilities") || "[]").filter(f => f.is_active !== false);
  const [formData, setFormData] = useState({
    title: '',
    desc: '',
    pic_id: user.id || '',
    pic: user.name,
    facility: '',
    deadline: new Date().toISOString().slice(0, 16),
    status: defaultStatus || 'todo',
    urgent: false
  });
  
  const [picOptions, setPicOptions] = useState([]);

  // Auto-fill facility based on selected PIC's facility OR department
  useEffect(() => {
    if (!formData.pic_id && !formData.pic) return;
    
    // Tìm người dùng theo pic_id (ID số) hoặc tên
    const selectedPic = picOptions.find(u => String(u.id) === String(formData.pic_id) || u.name === formData.pic);
    if (selectedPic) {
      setFormData(prev => ({
        ...prev,
        pic: selectedPic.name,
        facility: selectedPic.facility_id ? String(selectedPic.facility_id) : prev.facility
      }));
    }
  }, [formData.pic_id, picOptions]);

  // Compute available facilities and departments based on selected PIC
  const { filteredFacilities, availableDepts } = React.useMemo(() => {
    let facs = activeFacilities;
    let depts = ['BGD', 'MARKETING', 'FINANCE'];
    
    if (formData.pic) {
      const selectedPic = picOptions.find(u => String(u.id) === String(formData.pic_id) || u.name === formData.pic);
      if (selectedPic && !['SUPER_ADMIN', 'ADMIN', 'VICE_PRESIDENT'].includes(selectedPic.role)) {
        const rawFac = selectedPic.facility_code || selectedPic.facility_id || selectedPic.facility_name || '';
        const facCodes = Array.isArray(rawFac) ? rawFac.map(s => String(s).toLowerCase()) : String(rawFac).toLowerCase().split(',').map(s => s.trim());
        
        facs = activeFacilities.filter(f => 
          facCodes.some(code => code === String(f.code).toLowerCase() || code === String(f.name).toLowerCase() || String(f.name).toLowerCase().includes(code))
        );
        
        depts = [];
        if (selectedPic.department_id === 'BGD' || selectedPic.role === 'VICE_PRESIDENT') depts.push('BGD');
        if (selectedPic.department_id === 'MARKETING') depts.push('MARKETING');
        if (selectedPic.department_id === 'FINANCE' || selectedPic.role === 'FINANCE_DEPT') depts.push('FINANCE');
      }
    }
    return { filteredFacilities: facs, availableDepts: depts };
  }, [formData.pic, formData.pic_id, picOptions]);
  
  // Auto-select if there is only 1 option
  React.useEffect(() => {
    if (formData.pic) {
      const allOptions = [...filteredFacilities.map(f => f.name), ...availableDepts];
      if (allOptions.length === 1 && formData.facility !== allOptions[0]) {
         setFormData(prev => ({...prev, facility: allOptions[0]}));
      }
    }
  }, [formData.pic, filteredFacilities, availableDepts]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const token = localStorage.getItem('taskflow_token');
        const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/users', {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'x-user-role': user?.role || '',
            'x-facility-id': user?.facility_id || 'ALL'
          }
        });
        const data = await res.json();
        let allUsers = data.success ? data.data : JSON.parse(localStorage.getItem('taskflow_users') || '[]');
        
        allUsers = allUsers.map(u => {
          let updated = { ...u };
          return updated;
        });
        
        let filtered = [];
        if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user.role)) {
          filtered = allUsers;
        } else {
          filtered = allUsers.filter(u => String(u.id) === String(user.id) || u.name === user.name);
        }
        setPicOptions(filtered);
      } catch(e) {
        const allUsers = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
        let filtered = [];
        if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user.role)) {
          filtered = allUsers;
        } else {
          filtered = allUsers.filter(u => String(u.id) === String(user.id) || u.name === user.name);
        }
        setPicOptions(filtered);
      }
    };
    fetchUsers();
  }, [user?.id, user?.role, user?.facility_id, user?.facility_name]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      id: Date.now(),
      ...formData,
      facility: formData.facility || (user.role === 'SUPER_ADMIN' ? 'HQ' : (Array.isArray(user.facility_id) ? 'ALL' : user.facility_id))
    });
    onClose();
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-xl rounded-2xl shadow-2xl border border-outline-variant dark:border-gray-800 p-6 flex flex-col max-h-[90vh]">
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 text-truncate truncate">Người phụ trách (PIC)</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">person</span>
                <select required name="pic_id" value={formData.pic_id || ''} onChange={handleChange} className="w-full pl-9 pr-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white truncate">
                  <option value="">-- Chọn PIC --</option>
                  {picOptions.map(u => (
                    <option key={u.id || u.username} value={u.id}>{u.name} {u.role === 'FACILITY_MANAGER' ? '(QL)' : ''}</option>
                  ))}
                  {/* Fallback option if user's own name is not in the list but they want to assign to themselves */}
                  {!picOptions.find(u => u.id === user.id || u.name === user.name) && (
                    <option value={user.id || user.name}>{user.name} (Bạn)</option>
                  )}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 text-truncate truncate">Cơ sở / Phòng ban</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">corporate_fare</span>
                <select 
                  name="facility" 
                  value={formData.facility} 
                  onChange={handleChange} 
                  disabled={isLocalLocked}
                  className="w-full pl-9 pr-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white truncate disabled:opacity-70 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                >
                  {isLocalLocked ? (() => {
                    let resolvedDept = user.department_code || user.department_id;
                    if (!resolvedDept) {
                      if (user.role === 'FINANCE_DEPT') resolvedDept = 'FINANCE';
                      else if (user.role === 'DEPARTMENT_HEAD') resolvedDept = 'MARKETING';
                      else if (user.role === 'VICE_PRESIDENT') resolvedDept = 'BGD';
                    }
                    return (
                      <option value={user.facility_id || resolvedDept}>
                        {user.role === 'FACILITY_MANAGER' 
                          ? (
                              user.facility_name || 
                              activeFacilities.find(f => String(f.id) === String(user.facility_id) || f.code === user.facility_id)?.name || 
                              user.facility_id
                            )
                          : (
                              {
                                'MARKETING': 'Phòng Truyền thông', 
                                'FINANCE': 'Phòng Kế toán', 
                                'IT': 'Phòng IT', 
                                'HR': 'Phòng Nhân sự', 
                                'BGD': 'Ban Giám đốc'
                              }[resolvedDept] || resolvedDept
                            )
                        }
                      </option>
                    );
                  })() : (
                    <>
                      <option value="">-- Tự động --</option>
                      {(filteredFacilities || []).map(f => (
                        <option key={f.id || f.name} value={f.name}>{f.name}</option>
                      ))}
                      {availableDepts.includes('BGD') && <option value="BGD">Ban Giám đốc</option>}
                      {availableDepts.includes('MARKETING') && <option value="MARKETING">Phòng Truyền thông</option>}
                      {availableDepts.includes('FINANCE') && <option value="FINANCE">Phòng Kế toán</option>}
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Deadline</label>
            <div className="flex gap-2 items-center md:w-3/4">
              <input required type="date" value={formData.deadline.slice(0,10)} onChange={(e) => setFormData({...formData, deadline: e.target.value + 'T' + formData.deadline.slice(11)})} className="flex-1 min-w-0 px-2 md:px-3 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white" />
              <select value={formData.deadline.slice(11,13)} onChange={(e) => setFormData({...formData, deadline: formData.deadline.slice(0,11) + e.target.value + formData.deadline.slice(13)})} className="w-[52px] md:w-16 shrink-0 px-1 md:px-2 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white">
                {Array.from({length:24}).map((_, i) => { const h = i.toString().padStart(2, '0'); return <option key={h} value={h}>{h}</option>; })}
              </select>
              <span className="font-bold dark:text-gray-400 shrink-0">:</span>
              <select value={formData.deadline.slice(14,16)} onChange={(e) => setFormData({...formData, deadline: formData.deadline.slice(0,14) + e.target.value})} className="w-[52px] md:w-16 shrink-0 px-1 md:px-2 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white">
                {['00','05','10','15','20','25','30','35','40','45','50','55'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
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

// --- ERROR BOUNDARY ---



const DEPT_MAPPING = {
  'MARKETING': ['phòng truyền thông', 'marketing', 'truyền thông', 'mkt'],
  'FINANCE': ['kế toán', 'tài chính', 'finance', 'ketoan'],
  'BGD': ['giám đốc', 'ban giám đốc', 'bgd', 'phó'],
};

const filterTaskForDeptHead = (t, currentUser, deptId) => {
  const isOwner = t.createdBy === currentUser?.username || t.creator_role === currentUser?.role; 
  const isAssignee = t.pic === currentUser?.username || t.picId === currentUser?.email || t.picId === '@' + currentUser?.username;
  if (isOwner || isAssignee) return true;

  const tFacCode = String(t?.facilityId || t?.facility || '').toLowerCase();
  const tDeptTag = String(t?.department_tag || '').toUpperCase();
  const currentDept = String(deptId).toUpperCase();

  if (tDeptTag === currentDept) return true;

  const validKeywords = DEPT_MAPPING[currentDept] || [currentDept.toLowerCase()];
  const matchesDept = validKeywords.some(keyword => tFacCode.includes(keyword) || String(t?.facility || '').toLowerCase().includes(keyword));

  return matchesDept;
};

function MainDashboard() {
  const isFetchingTasks = useRef(false);
  const notifiedTaskIds = useRef(new Set()); // Bức tường chặn Spam Ping
  const { user, logout } = useContext(AuthContext);
  const [viewMode, setViewMode] = useState('kanban');
  const [darkMode, setDarkMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    if (!user) return 'tasks';
    
    if (user.role === 'ADMIN') return 'admin';
    if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD'].includes(user.role)) return 'ai-advisor';
    if (['FINANCE_DEPT', 'FACILITY_MANAGER'].includes(user.role)) return 'dashboard';
    return 'tasks';
  });
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  const [aiSessions, setAiSessions] = useState([]);
  const [activeAiSessionId, setActiveAiSessionId] = useState(localStorage.getItem('taskflow_active_ai_session_id') || null);

  React.useEffect(() => {
    if (activeAiSessionId) {
      localStorage.setItem('taskflow_active_ai_session_id', activeAiSessionId);
    } else {
      localStorage.removeItem('taskflow_active_ai_session_id');
    }
  }, [activeAiSessionId]);

  React.useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await axiosClient.get('/api/ai/sessions');
        if (res.success && res.data) {
           setAiSessions(res.data);
           // Auto-Select: Nếu chưa có activeSessionId và có data, chọn cái đầu tiên (mới nhất)
           if (res.data.length > 0 && !activeAiSessionId) {
               setActiveAiSessionId(res.data[0].id);
           }
        }
      } catch (err) {
        console.error("Lỗi fetch AI sessions:", err);
      }
    };
    fetchSessions();
  }, []); // Gọi 1 lần lúc khởi tạo app
  const [tasks, setTasks] = useState([]);
  const [globalFacilityFilter, setGlobalFacilityFilter] = useState(() => {
    return user?.role === 'FACILITY_MANAGER' ? (user?.facility_code || user?.facility_id || '') : 'ALL';
  });
  const [facilitiesList, setFacilitiesList] = useState([]);
  
  React.useEffect(() => {
    try {
      const localFacs = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
      const facs = localFacs.filter(f => !f.isExecutive && f.id !== 'vp1' && f.id !== 'vp2' && !['MARKETING', 'MAKETING', 'FINANCE', 'BGD'].includes(String(f.name || '').toUpperCase()));
      setFacilitiesList([
        ...facs,
        { id: 'dept1', name: 'Phòng Truyền thông', filterValue: 'MARKETING' },
        { id: 'dept2', name: 'Phòng Tài chính', filterValue: 'FINANCE' },
        { id: 'dept3', name: 'Ban Giám Đốc', filterValue: 'BGD' }
      ]);
    } catch {}
  }, []);
  
  const isVPGlobal = user?.role === 'VICE_PRESIDENT';
  const isDeptHeadGlobal = ['DEPARTMENT_HEAD'].includes(user?.role);
  const deptIdGlobal = user?.department_id || (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : (isVPGlobal ? 'BGD' : 'MARKETING'));
  const isReadOnlyView = isDeptHeadGlobal && globalFacilityFilter !== deptIdGlobal && deptIdGlobal !== 'MARKETING';

  // Derived state for filtering tasks

  const filteredTasks = tasks.filter(t => {
     const isHighLevel = user?.role !== 'DEPARTMENT_HEAD' && (user?.facility_id === 'ALL' || (Array.isArray(user?.facility_id) && user?.facility_id.includes('ALL')) || ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user?.role));
     const isVP = user?.role === 'VICE_PRESIDENT';
     const isDeptHead = ['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role) || isVP;
     const deptId = user?.department_id || (user?.username === 'marketing' ? 'MARKETING' : (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : (isVP ? 'BGD' : 'MARKETING')));

     // 🚨 BỨC TƯỜNG TIN TƯỜNG BACKEND (TRUST THE BACKEND) 🚨
     // Nhóm Quản lý Cơ sở (FACILITY_MANAGER) và Nhân viên (LOCAL) đã được Backend lọc 100% chuẩn xác.
     // Bỏ qua toàn bộ mớ bòng bong so sánh chuỗi bên dưới. Trả về TRUE ngay lập tức!
     if (!isHighLevel && !isDeptHead) {
         return true; 
     }

     if (isHighLevel && globalFacilityFilter === 'ALL') return true;
     if (isHighLevel && globalFacilityFilter !== 'ALL') {
         const tTitle = String(t.title || '').toLowerCase();
         const tFacName = String(t?.facilityId || t?.facility || '').toLowerCase();
         const tDeptTag = String(t?.department_tag || '').toLowerCase();
         const filterLower = String(globalFacilityFilter).toLowerCase();
         return tFacName.includes(filterLower) || tTitle.includes(filterLower) || tDeptTag === filterLower;
     }
     
     if (isDeptHead) {
        // // if (globalFacilityFilter === 'ALL') return true;
        if (globalFacilityFilter && globalFacilityFilter !== 'ALL' && globalFacilityFilter !== deptId) {
            const filterLower = String(globalFacilityFilter).toLowerCase();
            const tFacCode = String(t?.facilityId || t?.facility || '').toLowerCase();
            const tFacName = String(t?.facility || '').toLowerCase();
            return tFacCode.includes(filterLower) || tFacName.includes(filterLower);
        }
        return filterTaskForDeptHead(t, user, deptId);
     }
     
     if (globalFacilityFilter && globalFacilityFilter !== 'ALL') {
         const filterLower = String(globalFacilityFilter).toLowerCase();
         const tFacCode = String(t?.facilityId || '').toLowerCase();
         const tFacName = String(t?.facility || '').toLowerCase();
         
         // BỨC TƯỜNG THÉP: So khớp ID nguyên bản (Tuyệt đối không lệch)
         const matchRawId = t?.facilityRawId !== undefined && String(t.facilityRawId) === String(user?.facility_id);
         
         return tFacCode.includes(filterLower) || tFacName.includes(filterLower) || matchRawId;
     }

     return true;
  });



  const [facilityStatuses, setFacilityStatuses] = useState([]);
  const [isCheckinCompleted, setIsCheckinCompleted] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAITaskModal, setShowAITaskModal] = useState(false);
  const [showClosureConfirm, setShowClosureConfirm] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalStatus, setCreateModalStatus] = useState('todo');
  const [toastMessage, setToastMessage] = useState('');
  const [selectedTaskComments, setSelectedTaskComments] = useState([]);

  useEffect(() => {
    if (selectedTask) {
      const taskId = selectedTask.id || selectedTask.task_id;
      if (taskId) {
        setSelectedTaskComments([]); // Chống rò rỉ State
        const fetchComments = async () => {
          try {
            const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/comments`, {
              headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
                'x-user-id': user?.id,
                'x-user-role': user?.role, 
                'x-facility-id': user?.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user?.facility_id) ? user.facility_id.join(',') : user?.facility_id) 
              }
            });
            const data = await res.json();
            if (data.success) {
              setSelectedTaskComments(data.data);
            }
          } catch (err) {
            console.error("Error fetching comments:", err);
          }
        };
        fetchComments();
      }
    } else {
      setSelectedTaskComments([]);
    }
  }, [selectedTask?.id, selectedTask?.task_id, user]);
  
  // Audio Notification Logic (5 seconds loud siren)
  const playNotificationSound = () => {
    try {
      // 1. Dùng âm thanh audio file có sẵn để tránh lỗi Web Audio API trên một số trình duyệt
      const audio = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
      audio.volume = 1.0;
      audio.play().catch(e => {
        console.log('Audio fallback failed, trying Web Audio API...', e);
        // Fallback: Web Audio API
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        const playBeep = (startTime, duration, freq1, freq2) => {
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq1, startTime);
          osc.frequency.linearRampToValueAtTime(freq2, startTime + duration);
          gainNode.gain.setValueAtTime(1.0, startTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + duration);
        };
        let now = ctx.currentTime;
        for (let i = 0; i < 10; i++) {
          playBeep(now + i * 0.5, 0.4, 880, 1100);
        }
      });
    } catch(e) {
      console.log('Audio playback prevented', e);
    }
  };

  const [taskComments, setTaskComments] = useState(() => {
    try { return JSON.parse(localStorage.getItem('stitch_comments') || '{}'); } catch { return {}; }
  });
  const [facilityList, setFacilityList] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState(() => {
    try { return JSON.parse(localStorage.getItem('taskflow_notifications') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    const checkNotifications = () => {
      try { setNotifications(JSON.parse(localStorage.getItem('taskflow_notifications') || '[]')); } catch {}
    };
    window.addEventListener('storage', checkNotifications);
    window.addEventListener('taskflow_notify', checkNotifications);
    const interval = setInterval(checkNotifications, 5000);
    return () => {
      window.removeEventListener('storage', checkNotifications);
      window.removeEventListener('taskflow_notify', checkNotifications);
      clearInterval(interval);
    };
  }, []);

  const fetchFacilities = async () => {
    try {
      const token = localStorage.getItem('taskflow_token');
      const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/facilities', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.data) {
        const mappedFacs = data.data.map(fac => ({
          id: String(fac.id),
          name: fac.name,
          is_active: fac.is_active !== false
        }));
        setFacilityList(mappedFacs);
        const filteredFacs = mappedFacs.filter(f => !f.isExecutive && f.id !== 'vp1' && f.id !== 'vp2' && !['MARKETING', 'MAKETING', 'FINANCE', 'BGD'].includes(String(f.name || '').toUpperCase()));
        setFacilitiesList([
          ...filteredFacs,
          { id: 'dept1', name: 'Phòng Truyền thông', filterValue: 'MARKETING' },
          { id: 'dept2', name: 'Phòng Tài chính', filterValue: 'FINANCE' },
          { id: 'dept3', name: 'Ban Giám Đốc', filterValue: 'BGD' }
        ]);
        localStorage.setItem('taskflow_facilities', JSON.stringify(mappedFacs));
        return;
      }
    } catch (e) {
      console.error('Lỗi đồng bộ danh sách cơ sở từ server:', e);
    }

    let localFacs = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
    if (localFacs.length === 0) {
      localFacs = [
        { id: 'f1', name: 'DUBAI 41', is_active: true },
        { id: 'f2', name: 'DUBAI ACE', is_active: true },
        { id: 'f3', name: 'DUBAI PA', is_active: true },
        { id: 'f4', name: 'DUBAI PAK', is_active: true },
        { id: 'f5', name: 'DUBAI PAV', is_active: true },
        { id: 'f6', name: 'DUBAI PQ', is_active: true }
      ];
      localStorage.setItem('taskflow_facilities', JSON.stringify(localFacs));
    }
    setFacilityList(localFacs);
    const filteredLocalFacs = localFacs.filter(f => !f.isExecutive && f.id !== 'vp1' && f.id !== 'vp2' && !['MARKETING', 'MAKETING', 'FINANCE', 'BGD'].includes(String(f.name || '').toUpperCase()));
    setFacilitiesList([
      ...filteredLocalFacs,
      { id: 'dept1', name: 'Phòng Truyền thông', filterValue: 'MARKETING' },
      { id: 'dept2', name: 'Phòng Tài chính', filterValue: 'FINANCE' },
      { id: 'dept3', name: 'Ban Giám Đốc', filterValue: 'BGD' }
    ]);
  };

  const fetchKPIs = async () => {
    try {
      const authStr = localStorage.getItem('taskflow_auth');
      const auth = authStr ? JSON.parse(authStr) : null;
      const token = auth ? auth.token : '';
      const user = auth ? auth.user : null;
      
      const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/kpi', {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'x-user-role': user?.role || '',
          'x-facility-id': user?.facility_id || ''
        }
      });
      const responseJson = await res.json();
      if (responseJson.success && responseJson.data && responseJson.data.data) {
        let kpiData = responseJson.data.data;
        let depth = 0;
        while (typeof kpiData === 'string' && depth < 5) {
          try {
            kpiData = JSON.parse(kpiData);
            depth++;
          } catch (err) {
            break;
          }
        }
        localStorage.setItem('taskflow_facility_kpis', JSON.stringify(kpiData || {}));
        window.dispatchEvent(new Event('taskflow_kpis_updated'));
      }
    } catch (e) {
      console.error('Lỗi đồng bộ KPI từ server:', e);
    }
  };

  const fetchSystemConfig = async () => {
    try {
      const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/logs');
      const data = await res.json();
      if (data.success && data.data) {
        const configLog = data.data.find(log => log.entry_type === 'SYSTEM_CONFIG');
        if (configLog && configLog.content) {
           let content = configLog.content;
           if (typeof content === 'string') content = JSON.parse(content);
           
           if (content.ai_config) {
             localStorage.setItem('taskflow_ai_config', JSON.stringify(content.ai_config));
           }
           if (content.system_prompts) {
             localStorage.setItem('taskflow_system_prompts', JSON.stringify(content.system_prompts));
           }
        }
      }
    } catch (e) {
      console.error('Lỗi lấy system config từ server:', e);
    }
  };

  useEffect(() => {
    fetchSystemConfig();
    fetchFacilities();
    fetchKPIs();
  }, []);
  
  // Dashboard time filter and stats
  const [timeFilter, setTimeFilter] = useState('week'); // 'week' | 'month'
  const [dashboardStats, setDashboardStats] = useState({ open: 0, completed: 0, overdue: 0 });
  const [isStatsLoading, setIsStatsLoading] = useState(false);

  const fetchDashboardStats = (filter) => {
    setIsStatsLoading(true);
    
    // Simulate API network delay
    setTimeout(() => {
      const now = new Date('2026-05-15T19:42:42+07:00'); // Use system time as per metadata
      let start, end;
      
      if (filter === 'week') {
        // This week (Monday to Sunday)
        const day = now.getDay() || 7; // Convert Sun(0) to 7
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(now.getDate() - day + 1); // Monday
        
        end = new Date(start);
        end.setDate(start.getDate() + 6); // Sunday
        end.setHours(23, 59, 59, 999);
      } else {
        // This month
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
      }

      // 1. RBAC Check: Ensure we only query tasks for the current facility if FACILITY_MANAGER
      // Note: We use INITIAL_TASKS here to simulate backend database query
      let userTasks = INITIAL_TASKS;
      if (user.role === 'FACILITY_MANAGER') {
        userTasks = INITIAL_TASKS.filter(t => t.facility === user.facility_id);
      }
      
      let open = 0;
      let completed = 0;
      let overdue = 0;
      
      userTasks.forEach(t => {
        const createdAt = new Date(t.createdAt || t.deadline); 
        const deadline = new Date(t.deadline);
        const isDone = t.status === 'done' || t.status === 'review';
        const completedAt = t.completedAt ? new Date(t.completedAt) : null;
        
        // Công việc Mở: Đếm tổng task được tạo trong Timeframe VÀ chưa đóng
        if (createdAt >= start && createdAt <= end && !isDone) {
          open++;
        }
        
        // Công việc Hoàn thành: Đếm tổng task có trạng thái đóng/nghiệm thu nằm trong Timeframe
        if (isDone && completedAt && completedAt >= start && completedAt <= end) {
          completed++;
        }
        
        // Công việc Trễ hạn: Đếm tổng task có Deadline rơi vào Timeframe 
        // nhưng hiện tại chưa hoàn thành hoặc hoàn thành sau deadline
        if (deadline >= start && deadline <= end) {
          if (!isDone) {
            // Unfinished: check if deadline has passed compared to NOW
            if (now > deadline) overdue++;
          } else if (completedAt && completedAt > deadline) {
            // Finished but completed after the deadline
            overdue++;
          }
        }
      });
      
      setDashboardStats({ open, completed, overdue });
      setIsStatsLoading(false);
    }, 800); // UI loading feel
  };

  useEffect(() => {
    if (user) {
      fetchDashboardStats(timeFilter);
    }
  }, [user?.id, timeFilter]); // Fetch when timeFilter changes

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleAITaskConfirm = async (draftTasks) => {
    if (!draftTasks || draftTasks.length === 0) return;

    const addedTasks = [];
    let hasFatalError = false; // Cầu dao ngắt mạch (Circuit Breaker)
    const allUsers = JSON.parse(localStorage.getItem('taskflow_users') || '[]');

    // Lặp tuần tự nhưng sẵn sàng ngắt cầu dao
    for (const draft of draftTasks) {
      if (hasFatalError) break; // Kích hoạt ngắt mạch nếu có lỗi trước đó

      try {
        let resolvedPicId = user.id;
        if (draft.pic) {
          const searchName = draft.pic.toLowerCase().trim();
          const foundUser = allUsers.find(u => 
            (u.full_name && u.full_name.toLowerCase().includes(searchName)) || 
            (u.email && u.email.toLowerCase().includes(searchName)) ||
            (u.username && u.username.toLowerCase().includes(searchName))
          );
          if (foundUser) resolvedPicId = foundUser.id;
        }

        // BỨC TƯỜNG DỮ LIỆU: Tôn trọng sự thật, không ép kiểu bừa bãi
        const taskPayload = {
          ...draft,
          pic_id: resolvedPicId,
          // Nếu AI trả về rỗng, giữ nguyên chuỗi rỗng để Backend nhận diện và gán pic_id = null
          pic: draft.pic ? draft.pic.trim() : "", 
          deadline: draft.deadline || new Date().toISOString().split('T')[0],
          urgent: draft.urgent || false,
          facility_id: user.facility_id, // BẮT BUỘC TRUYỀN RAW ID XUỐNG BACKEND
          creator_role: user.role,
          desc: (draft.desc || "") + " <!--cr:" + user.role + "-->",
        };
        
        // DÙNG AXIOS ĐỂ TỰ ĐỘNG BƠM JWT TOKEN - CẤM DÙNG FETCH RAW
        const res = await axiosClient.post('/api/tasks', taskPayload);
        
        if (res.success) {
          addedTasks.push(res.data);
        } else {
          console.error("Server từ chối lưu task:", res.error);
          hasFatalError = true; // Sập cầu dao!
          showToast('Lỗi bảo mật/phân quyền: ' + (res.error || 'Từ chối truy cập (403)'));
        }
      } catch (e) { 
        console.error("Lỗi Exception lưu AI task:", e); 
        hasFatalError = true; // Sập cầu dao!
        const errorMessage = e.response?.data?.message || e.response?.data?.error || 'Lỗi kết nối nghiêm trọng. Đã ngắt tiến trình.';
        showToast(errorMessage);
      }
    }
    
    // Cập nhật UI an toàn
    if (addedTasks.length > 0) {
      setTasks(prev => [...addedTasks, ...prev]);
      showToast(`Đã lưu cứng thành công ${addedTasks.length} công việc từ AI.`);
    } else if (!hasFatalError) {
      showToast(`AI không tạo ra dữ liệu hợp lệ.`);
    }
  };

  const handleCreateTask = async (newTask) => {
    try {
      const isVP = user?.role === 'VICE_PRESIDENT';
      const isDeptHeadLocal = ['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role) || isVP;
      const deptId = user?.department_id || (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : (isVP ? 'BGD' : 'MARKETING'));
      const taskFacility = user?.role === 'SUPER_ADMIN' ? 'BGD' : (isDeptHeadLocal ? deptId : user?.facility_id);
      const safeFacility = Array.isArray(taskFacility) ? taskFacility[0] : taskFacility;
      
      const taskPayload = {
        pic_id: user.id,
        pic: user.name,
        deadline: new Date().toISOString().split('T')[0],
        urgent: false,
        creator_role: user.role,
          ...newTask, desc: (newTask.desc || "") + " <!--cr:" + user.role + "-->",
        facility: newTask.facility || taskFacility,
        ...(deptId && isDeptHeadLocal ? { department_tag: deptId } : {})
      };
      
      const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': user.role,
          'x-facility-id': safeFacility || 'ALL'
        },
        body: JSON.stringify(taskPayload)
      });
      
      if (res.status === 500 || !res.ok) {
         throw new Error('Lỗi máy chủ');
      }
      
      const data = await res.json();
      if (data.success) {
        setTasks(prev => [data.data, ...prev]);
        showToast('Tạo công việc thành công');
      } else {
        throw new Error(data.error || 'Lỗi server');
      }
    } catch (e) {
      console.error("Lỗi API Tạo công việc:", e);
      showToast('Lỗi Server: Không thể tạo công việc. Vui lòng tải lại trang!', 'error');
    }
  };

  const handleUpdateTaskStatus = async (taskId, newStatus, evidenceName = null) => {
    try {
      const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': user.role,
          'x-facility-id': localStorage.getItem('facility_id') || user.facility_id || 'ALL'
        },
        body: JSON.stringify({ status: newStatus, evidence: evidenceName })
      });
      
      if (!res.ok) throw new Error('API Error');
      
      const data = await res.json();
      if (data.success) {
        setTasks(tasks.map(t => t.id === taskId ? {...t, status: newStatus, evidence: evidenceName || t.evidence} : t));
        setSelectedTask({...selectedTask, status: newStatus, evidence: evidenceName || selectedTask.evidence});
      } else {
        throw new Error('Lỗi server');
      }
    } catch (e) {
      console.error("Fallback offline update status:", e);
      const updatedTasks = tasks.map(t => t.id === taskId ? {...t, status: newStatus, evidence: evidenceName || t.evidence} : t);
      setTasks(updatedTasks);
      setSelectedTask({...selectedTask, status: newStatus, evidence: evidenceName || selectedTask.evidence});
      
      // Update local storage for offline persistence
      const localTasks = JSON.parse(localStorage.getItem('taskflow_tasks') || '[]');
      const updatedLocal = localTasks.map(t => t.id === taskId ? {...t, status: newStatus, evidence: evidenceName || t.evidence} : t);
      localStorage.setItem('taskflow_tasks', JSON.stringify(updatedLocal));
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa vĩnh viễn task này không? Hành động này không thể hoàn tác!')) return;
    try {
      const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        setTasks(tasks.filter(t => t.id !== taskId));
        setSelectedTask(null);
        showToast('Đã xóa task vĩnh viễn', 'success');
      } else {
        throw new Error(data.error || 'Lỗi server');
      }
    } catch (e) {
      console.error("Delete task error:", e);
      showToast(e.message || 'Lỗi Server: Không thể xóa task', 'error');
    }
  };

  useEffect(() => {
    // 1. Cởi trói điều kiện khắt khe: Chỉ cần tồn tại Object user là cho phép chạy
    if (!user || isFetchingTasks.current) return;

    let isMounted = true; // Khóa an toàn chống Memory Leak khi component bị hủy

    const fetchTasks = async () => {
        isFetchingTasks.current = true;
        try {
          const res = await axiosClient.get('/api/tasks');
          
          if (!res.success) {
             setTasks([]);
             showToast('Lấy dữ liệu thất bại: ' + (res.error || ''));
             return;
          }
          
          const fetchedTasks = res.data || [];
          setTasks(fetchedTasks);
          
          // Notification polling logic
          const currentIds = new Set(fetchedTasks.map(t => t.id));
          const currentComments = fetchedTasks.reduce((acc, t) => ({...acc, [t.id]: parseInt(t.comments_count || 0)}), {});
          let prevIds = new Set();
          let prevComments = {};
          try {
              const storedIds = sessionStorage.getItem('taskflow_prev_ids');
              if (storedIds) prevIds = new Set(JSON.parse(storedIds));
              const storedComments = sessionStorage.getItem('taskflow_prev_comments');
              if (storedComments) prevComments = JSON.parse(storedComments);
          } catch (e) {}
          
          if ((prevIds.size > 0 || Object.keys(prevComments).length > 0) && user) {
              fetchedTasks.forEach(task => {
                  const myNames = [String(user.name).toLowerCase(), String(user.username).toLowerCase(), '@' + String(user.username).toLowerCase()];
                  let isAssignedToMe = myNames.some(n => String(task.pic).toLowerCase().includes(n) || String(task.picId).toLowerCase().includes(n));
                  
                  if (!isAssignedToMe) {
                      const isVP = user?.role === 'VICE_PRESIDENT';
                      const isDeptHead = ['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role) || isVP;
                      const deptId = user?.department_id || (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : (isVP ? 'BGD' : 'MARKETING'));
                      // Chỉ lấy ID số nguyên để so sánh tuyệt đối
                      const currentUserFacilityId = Number(user?.facility_id);
                      const targetTaskFacilityId = Number(task?.facilityRawId);
                      
                      if (isDeptHead) {
                          if (filterTaskForDeptHead(task, user, deptId)) {
                              isAssignedToMe = true;
                          }
                      } else if (!['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user.role)) {
                          // CHỐT CHẶN DUY NHẤT: So sánh tuyệt đối ID Số nguyên của User và Task
                          if (
                              currentUserFacilityId && 
                              targetTaskFacilityId && 
                              currentUserFacilityId === targetTaskFacilityId
                          ) {
                              isAssignedToMe = true;
                          }
                      }
                  }
                  
                  if (isAssignedToMe && user.role !== 'SUPER_ADMIN') {
                      if (!prevIds.has(task.id) && task.status === 'todo') {
                          if (!notifiedTaskIds.current.has(`task_${task.id}`)) {
                              notifiedTaskIds.current.add(`task_${task.id}`);
                              const newNotif = {
                                  title: 'Công việc mới',
                                  message: 'Bạn được giao công việc: ' + task.title,
                                  time: new Date().toLocaleTimeString('vi-VN')
                              };
                              const notifs = JSON.parse(localStorage.getItem('taskflow_notifications') || '[]');
                              localStorage.setItem('taskflow_notifications', JSON.stringify([newNotif, ...notifs]));
                              window.dispatchEvent(new Event('taskflow_notify'));
                              setTimeout(() => { if(typeof playNotificationSound === 'function') playNotificationSound(); }, 500);
                          }
                      }
                  }
                  
                  const prevC = prevComments[task.id] || 0;
                  const currC = parseInt(task.comments_count || 0);
                  if (currC > prevC && task.latest_comment) {
                      const lc = task.latest_comment.toLowerCase();
                      const isMentioned = myNames.some(n => lc.includes(n)) || lc.includes('@all') || lc.includes('@tất cả') || (lc.includes('@ban giám đốc') && ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role));
                      if (isMentioned && String(task.latest_comment_user_id) !== String(user.id)) {
                          if (!notifiedTaskIds.current.has(`comment_${task.id}_${currC}`)) {
                              notifiedTaskIds.current.add(`comment_${task.id}_${currC}`);
                              const newNotif = {
                                  title: 'Nhắc tên (@)',
                                  message: 'Bạn được nhắc đến trong bình luận của công việc: ' + task.title,
                                  time: new Date().toLocaleTimeString('vi-VN')
                              };
                              const notifs = JSON.parse(localStorage.getItem('taskflow_notifications') || '[]');
                              localStorage.setItem('taskflow_notifications', JSON.stringify([newNotif, ...notifs]));
                              window.dispatchEvent(new Event('taskflow_notify'));
                              setTimeout(() => { if(typeof playNotificationSound === 'function') playNotificationSound(); }, 500);
                          }
                      }
                  }
              });
          }
          sessionStorage.setItem('taskflow_prev_ids', JSON.stringify(Array.from(currentIds)));
          sessionStorage.setItem('taskflow_prev_comments', JSON.stringify(currentComments));
        } catch (error) {
          console.error("Lỗi tải tasks:", error);
          showToast('Lỗi kết nối khi lấy dữ liệu');
        } finally {
          isFetchingTasks.current = false;
        }
    };

    const executeFetch = async () => {
        if (!isMounted) return;
        fetchTasks(); 
    };

    executeFetch();

    

    // 2. BỨC TƯỜNG DỌN DẸP (CLEANUP): Tiêu chuẩn Vàng của React 18
    return () => {
        isMounted = false;
        isFetchingTasks.current = false; // BẮT BUỘC MỞ KHÓA CHO LẦN MOUNT SAU!
        
    };
  }, [user?.id]); // BỨC TƯỜNG HIỆU NĂNG: Chỉ bám theo primitive properties để chống re-render vô tận

  const fetchFacilityStatuses = async () => {
    try {
      const response = await fetch('https://taskflow-ai-dashboard.onrender.com/api/checkin/status', {
        headers: { 'x-user-role': user.role, 'x-facility-id': localStorage.getItem('facility_id') || user.facility_id || 'ALL' }
      });
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
        if (user.role === 'FACILITY_MANAGER') setIsCheckinCompleted(false);
      }
    } catch (e) {
      setFacilityStatuses([{ facility_id: 'Cơ sở 1', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }, { facility_id: 'Cơ sở 2', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }]);
      if (user.role === 'FACILITY_MANAGER') setIsCheckinCompleted(false);
    }
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    if (!darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  };

  const handleCreateAISession = async () => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';
      const token = localStorage.getItem('taskflow_token');
      const response = await fetch(`${API_BASE_URL}/api/ai/sessions`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
          }
      });
      
      const res = await response.json();
      if (res.success && res.data) {
         const newSession = res.data;
         // Cập nhật State danh sách session để hiển thị session mới lên UI
         setAiSessions(prev => [newSession, ...prev]);
         // Tự động set activeSessionId bằng ID của session vừa tạo
         setActiveAiSessionId(newSession.id);
         
         if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'FACILITY_MANAGER', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role)) {
             setActiveTab('ai-advisor');
         } else {
             setShowAITaskModal(true);
         }
      } else {
         showToast('Không thể tạo phiên chat AI mới: ' + (res.error || 'Lỗi không xác định'));
      }
    } catch (err) {
      console.error('Lỗi tạo session:', err);
      showToast('Lỗi tạo phiên làm việc AI.');
    }
  };

  return (
    <div className={`flex h-screen w-full font-sans overflow-hidden ${darkMode ? 'dark bg-[#121212] text-white' : 'bg-surface text-on-surface'}`}>
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      
      <aside className={`w-64 bg-surface-container-low dark:bg-[#1e1e1e] border-r border-outline-variant dark:border-gray-800 flex flex-col transition-transform duration-300 fixed inset-y-0 left-0 z-40 md:relative transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-5 pb-4 border-b border-outline-variant dark:border-gray-800 flex items-center gap-2.5 bg-surface-container-low dark:bg-[#1e1e1e]">
          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="w-full h-full text-[#1A56DB] dark:text-[#3B82F6]" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="10"/>
              <circle cx="50" cy="50" r="28" stroke="currentColor" strokeWidth="3"/>
              <rect x="36" y="36" width="28" height="28" fill="currentColor"/>
              <path d="M50 16 L50 36 M50 64 L50 84 M16 50 L36 50 M64 50 L84 50" stroke="currentColor" strokeWidth="4"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-black text-lg leading-tight tracking-tight text-[#1A56DB] dark:text-[#3B82F6] truncate">Hub DUBAI AI</h1>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Gắn Kết Cùng Phát Triển</p>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
          {['FACILITY_MANAGER', 'STAFF'].includes(user.role) && (
            <>
              <NavItem icon="dashboard" label="Tổng quan" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
              <NavItem icon="assignment" label="Công việc" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
              <NavItem icon="history_toggle_off" label="Lịch sử CV" active={activeTab === 'task-history'} onClick={() => setActiveTab('task-history')} />
            </>
          )}
          {['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'VICE_PRESIDENT'].includes(user.role) && (
            <>
              <NavItem icon="dashboard" label={['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role) ? 'Tổng quan BĐH' : 'Tổng quan phòng ban'} active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
              <NavItem icon="pie_chart" label="Tổng quan doanh thu" active={activeTab === 'revenue-overview'} onClick={() => setActiveTab('revenue-overview')} />
              <NavItem icon="assignment" label="Công việc" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
              <NavItem icon="history_toggle_off" label="Lịch sử CV" active={activeTab === 'task-history'} onClick={() => setActiveTab('task-history')} />
              <NavItem icon="smart_toy" label="Cố vấn AI" active={activeTab === 'ai-advisor'} onClick={() => { setActiveAiSessionId(null); setActiveTab('ai-advisor'); }} />

            </>
          )}
          {user.role === 'FINANCE_DEPT' && (
            <>
              <NavItem icon="dashboard" label="Bảng tin" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
              <NavItem icon="assignment" label="Công việc" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
              <NavItem icon="history_toggle_off" label="Lịch sử CV" active={activeTab === 'task-history'} onClick={() => setActiveTab('task-history')} />
              <NavItem icon="smart_toy" label="Cố vấn AI" active={activeTab === 'ai-advisor'} onClick={() => { setActiveAiSessionId(null); setActiveTab('ai-advisor'); }} />
              <NavItem icon="pie_chart" label="Tổng quan doanh thu" active={activeTab === 'revenue-overview'} onClick={() => setActiveTab('revenue-overview')} />
              <NavItem icon="assessment" label="Báo cáo hằng ngày" active={activeTab === 'daily-reports'} onClick={() => setActiveTab('daily-reports')} />
              <NavItem icon="history" label="Nhật ký doanh thu" active={activeTab === 'revenue-log'} onClick={() => setActiveTab('revenue-log')} />
              <NavItem icon="target" label="Cài đặt KPI" active={activeTab === 'kpi-settings'} onClick={() => setActiveTab('kpi-settings')} />
              <NavItem icon="archive" label="Dữ liệu lưu trữ" active={activeTab === 'archives'} onClick={() => setActiveTab('archives')} />
            </>
          )}
          {user.role === 'FACILITY_MANAGER' && (
            <>
              <NavItem icon="fact_check" label="Điểm danh" active={activeTab === 'checkin'} onClick={() => setActiveTab('checkin')} />
              <NavItem icon="smart_toy" label="Cố vấn AI" active={activeTab === 'ai-advisor'} onClick={() => { setActiveAiSessionId(null); setActiveTab('ai-advisor'); }} />
            </>
          )}
          {user.role === 'SUPER_ADMIN' && (
              <>
                <NavItem icon="target" label="Cài đặt KPI" active={activeTab === 'kpi-settings'} onClick={() => setActiveTab('kpi-settings')} />
            </>
          )}
          {user.role === 'ADMIN' && (
            <>
              <NavItem icon="archive" label="Dữ liệu Lưu trữ" active={activeTab === 'archives'} onClick={() => setActiveTab('archives')} />
              <NavItem icon="settings" label="Cấu hình hệ thống" active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />
              <NavItem icon="api" label="Cấu hình API & AI" active={activeTab === 'api_config'} onClick={() => setActiveTab('api_config')} />
              <NavItem icon="memory" label="Nhật ký Hoạt động AI" active={activeTab === 'ai_logs'} onClick={() => setActiveTab('ai_logs')} />
              <NavItem icon="database" label="Quản lý Tri thức (RAG)" active={activeTab === 'rag_manager'} onClick={() => setActiveTab('rag_manager')} />
            </>
          )}

          {true && (
              <div className="mt-6 mb-2 px-4">
                <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 mb-3 flex items-center justify-between tracking-widest uppercase">
                   Lịch sử trò chuyện AI
                   <button onClick={handleCreateAISession} className="hover:text-primary transition-colors flex items-center" title="Cuộc hội thoại mới">
                      <span className="material-symbols-outlined text-[16px]">add_circle</span>
                   </button>
                </div>
                <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto custom-scrollbar pr-1">
                   {(!aiSessions || aiSessions.length === 0) ? (
                      <div className="text-xs text-gray-400 dark:text-gray-600 italic px-2">Chưa có lịch sử...</div>
                   ) : (
                      aiSessions.map(session => (
                         <div 
                            key={session.id} 
                            onClick={() => { 
                               setActiveAiSessionId(session.id); 
                               if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'FACILITY_MANAGER', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role)) { setActiveTab('ai-advisor');
                               } else {
                                  setShowAITaskModal(true);
                               }
                            }} 
                            className={`px-2 py-1.5 rounded-lg text-xs cursor-pointer truncate transition-colors flex items-center gap-2 ${activeAiSessionId === session.id ? 'bg-primary/10 text-primary dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                         >
                            <span className="material-symbols-outlined text-[14px]">chat_bubble_outline</span>
                            {session.title || 'Phiên AI mới'}
                         </div>
                      ))
                   )}
                </div>
             </div>
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
          <button onClick={() => setShowChangePasswordModal(true)} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors mb-2">
            <span className="material-symbols-outlined">key</span> Đổi mật khẩu
          </button>
          <button onClick={logout} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error-container dark:hover:bg-red-900/30 rounded-lg transition-colors">
            <span className="material-symbols-outlined">logout</span> Đăng xuất
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative transition-colors">
        <header className="h-16 border-b border-outline-variant dark:border-gray-800 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md flex items-center justify-between px-4 md:px-6 sticky top-0 z-10 transition-colors">
          <div className="flex items-center gap-2 md:gap-4 flex-1">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-full hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-500 transition-colors"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className="relative w-full max-w-sm">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">corporate_fare</span>
              <select 
                value={globalFacilityFilter} 
                onChange={(e) => setGlobalFacilityFilter(e.target.value)} 
                disabled={user.role === 'FACILITY_MANAGER'}
                className="w-full bg-surface-container dark:bg-gray-800 border-transparent focus:border-primary focus:ring-1 focus:ring-primary rounded-full pl-10 pr-4 py-2 text-sm outline-none transition-all dark:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="ALL">Tất cả cơ sở</option>
                {facilitiesList.map(f => (
                  <option key={f.id} value={f.filterValue || f.name}>{f.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggleDarkMode} className="p-2 rounded-full hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-500 transition-colors">
              <span className="material-symbols-outlined">{darkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 rounded-full hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-500 relative transition-colors"
              >
                <span className="material-symbols-outlined">notifications</span>
                {notifications.length > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-error rounded-full border-2 border-white dark:border-[#121212]"></span>}
              </button>
              
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#1e1e1e] rounded-xl shadow-lg border border-outline-variant dark:border-gray-800 z-50 overflow-hidden text-left">
                  <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-surface-container dark:bg-gray-800/50">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-200">Thông báo</h3>
                    {notifications.length > 0 && (
                      <button 
                        onClick={() => {
                          setNotifications([]);
                          localStorage.setItem('taskflow_notifications', '[]');
                        }}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        Đánh dấu đã đọc
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                        <span className="material-symbols-outlined text-4xl mb-2 opacity-50">notifications_paused</span>
                        <p className="text-sm">Không có thông báo mới</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-outline-variant dark:divide-gray-800">
                        {notifications.map((notif, idx) => (
                          <div key={idx} className="p-4 hover:bg-surface-variant dark:hover:bg-gray-800/50 transition-colors cursor-pointer group">
                            <p className="text-sm text-gray-800 dark:text-gray-200 font-medium group-hover:text-primary transition-colors">{notif.title}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{notif.message}</p>
                            <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[10px]">schedule</span>
                              {notif.time || 'Vừa xong'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 md:p-6 bg-surface-container-low dark:bg-[#181818] transition-colors custom-scrollbar">
          <div className="max-w-6xl mx-auto">
            {activeTab === 'checkin' ? (
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
                <div className="flex flex-col h-full w-full max-w-5xl mx-auto py-2">
                  <div className="bg-white dark:bg-[#1e1e1e] shadow-md rounded-2xl overflow-hidden border border-outline-variant dark:border-gray-700 h-[60vh] flex flex-col shrink-0 mb-6">
                    <AIAdvisor user={user} tasks={tasks} activeSessionId={activeAiSessionId} onSessionUpdate={setAiSessions} onSessionCreated={setActiveAiSessionId} />
                  </div>
                  <div className="mt-4 mb-12">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">dashboard_customize</span>
                      Truy cập nhanh
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {(() => {
                        let activeFacilities = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
                        activeFacilities = activeFacilities.filter(f => !f.isExecutive && f.id !== 'vp1' && f.id !== 'vp2');
                        const facilities = activeFacilities.map(f => {
                           const pendingTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'revoked' && (t.facility === f.name || t.facilityId === f.name));
                           return { name: f.name, count: pendingTasks.length, icon: 'corporate_fare', type: 'facility' };
                        });
                        
                        const allUsers = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
                        const vpUsers = allUsers.filter(u => u.role === 'VICE_PRESIDENT');
                        const executiveCards = vpUsers.map(vp => {
                           const facName = `Sếp ${vp.name || vp.username}`;
                           const pendingTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'revoked' && (t.facility === facName || t.facilityId === facName));
                           return { name: facName, count: pendingTasks.length, icon: 'work', type: 'executive' };
                        });
                        const depts = [
                           { name: 'Phòng Truyền thông', id: 'MARKETING', icon: 'campaign' },
                           { name: 'Phòng Kế Toán', id: 'FINANCE', icon: 'account_balance' },

                        ].map(d => {
                           const pendingTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'revoked' && t.department_tag === d.id);
                           return { name: d.name, count: pendingTasks.length, icon: d.icon, type: 'dept' };
                        });

                        const cards = [...facilities, ...depts, ...executiveCards].filter(c => c.count > 0 || c.type === 'facility' || c.type === 'dept' || c.type === 'executive');

                        return cards.map((c, i) => (
                          <div key={i} onClick={() => setActiveTab('facilities')} className="bg-white dark:bg-[#252525] p-5 rounded-xl border border-outline-variant dark:border-gray-700 hover:shadow-md hover:border-primary transition-all cursor-pointer group">
                             <div className="flex justify-between items-start mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.type === 'facility' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : c.type === 'dept' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'}`}>
                                   <span className="material-symbols-outlined text-[18px]">{c.icon}</span>
                                </div>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${c.count > 0 ? 'bg-error/10 text-error' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{c.count}</span>
                             </div>
                             <h4 className="font-bold text-sm text-gray-800 dark:text-gray-200 group-hover:text-primary transition-colors">{c.name}</h4>
                             <p className="text-xs text-gray-500 mt-1">{c.count} việc cần xử lý</p>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              </ErrorBoundary>
            ) : activeTab === 'admin' && user.role === 'ADMIN' ? (
              <ErrorBoundary>
                <AdminConfigPanel showToast={showToast} tasks={tasks} setTasks={setTasks} setTaskComments={setTaskComments} user={user} />
              </ErrorBoundary>
            ) : activeTab === 'api_config' && user.role === 'ADMIN' ? (
              <ErrorBoundary>
                <ApiConfigPanel showToast={showToast} />
              </ErrorBoundary>
            ) : activeTab === 'ai_logs' && user.role === 'ADMIN' ? (
              <ErrorBoundary>
                <AIUsageLogs />
              </ErrorBoundary>
            ) : activeTab === 'rag_manager' && user.role === 'ADMIN' ? (
              <ErrorBoundary>
                <RAGManagerPanel showToast={showToast} />
              </ErrorBoundary>
            ) : activeTab === 'dashboard' && (user.role === 'FACILITY_MANAGER' || ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'VICE_PRESIDENT'].includes(user.role)) ? (
              <ErrorBoundary>
                <FacilityDashboard user={user} tasks={tasks} onOpenTask={(task) => setSelectedTask(task)} globalFacilityFilter={globalFacilityFilter} />
              </ErrorBoundary>
            ) : activeTab === 'revenue-overview' && ['SUPER_ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD', 'VICE_PRESIDENT'].includes(user.role) ? (
              <ErrorBoundary>
                <RevenueOverviewDashboard user={user} facilityList={facilityList} />
              </ErrorBoundary>
            ) : activeTab === 'kpi-settings' && ['SUPER_ADMIN', 'FINANCE_DEPT', 'VICE_PRESIDENT'].includes(user.role) ? (
              <ErrorBoundary>
                <KPISettings user={user} facilityList={facilityList} showToast={showToast} refreshFacilities={fetchFacilities} />
              </ErrorBoundary>
            ) : activeTab === 'ai-advisor' ? (
              <ErrorBoundary>
                <div className="flex flex-col h-full w-full max-w-5xl mx-auto py-2">
                  <div className="bg-white dark:bg-[#1e1e1e] shadow-md rounded-2xl overflow-hidden border border-outline-variant dark:border-gray-700 h-[calc(100vh-120px)] flex flex-col shrink-0">
                    <AIAdvisor user={user} tasks={tasks} activeSessionId={activeAiSessionId} onSessionUpdate={setAiSessions} onSessionCreated={setActiveAiSessionId} />
                  </div>
                </div>
              </ErrorBoundary>
            ) : activeTab === 'archives' && ['ADMIN', 'FINANCE_DEPT'].includes(user.role) ? (
              <ErrorBoundary>
                <ArchivedFacilitiesDashboard facilityList={facilityList} showToast={showToast} refreshFacilities={fetchFacilities} />
              </ErrorBoundary>
            ) : activeTab === 'task-history' ? (
              <ErrorBoundary>
                <div className="flex flex-col h-full w-full max-w-5xl mx-auto py-2">
                  <TaskHistory />
                </div>
              </ErrorBoundary>
            ) : activeTab === 'daily-reports' && ['FINANCE_DEPT'].includes(user.role) ? (
              <ErrorBoundary>
                <DailyRevenueReport user={user} facilityList={facilityList} showToast={showToast} />
              </ErrorBoundary>
            ) : activeTab === 'revenue-log' && ['FINANCE_DEPT', 'DEPARTMENT_HEAD', 'SUPER_ADMIN'].includes(user.role) ? (
              <ErrorBoundary>
                <RevenueLog user={user} showToast={showToast} />
              </ErrorBoundary>

            ) : (
              <>
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-on-surface dark:text-white">
                      {user.role === 'SUPER_ADMIN' ? 'Tổng quan Toàn chuỗi' : (user.facility_id === 'ALL' || user.facility_id === 'undefined' || !user.facility_id ? 'Dashboard' : `Dashboard - ${user.facility_id}`)}
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
                    </div>
                    {!isReadOnlyView && (
                      <div className="flex gap-2">
                          <button onClick={() => setShowAITaskModal(true)} className="bg-secondary hover:bg-secondary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-md shadow-secondary/20 transition-all">
                            <span className="material-symbols-outlined text-[18px]">auto_awesome</span> <span className="hidden sm:inline">Trích xuất Biên bản</span>
                          </button>
                          <button onClick={() => setShowCreateModal(true)} className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-md shadow-primary/20 transition-all">
                            <span className="material-symbols-outlined text-[18px]">add</span> Mới
                          </button>
                      </div>
                    )}
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


                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">monitor_heart</span>
                    Trạng thái Báo Cáo Cơ Sở Real-time
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {facilityStatuses.filter(f => user.role === 'SUPER_ADMIN' || f.facility_id === user.facility_id).map((fac, idx) => (
                      <div key={idx} className="p-4 bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm flex flex-col gap-3">
                        <span className="text-sm font-bold dark:text-white border-b border-gray-100 dark:border-gray-800 pb-2">{fac.facility_id}</span>
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-medium text-gray-500 dark:text-gray-400">Ca 1 (Sáng)</span>
                          {fac.ca1 === 'Đã báo cáo' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-success dark:text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-success"></span> Đã báo cáo</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-error dark:text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span> Chưa báo cáo</span>
                          )}
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-medium text-gray-500 dark:text-gray-400">Ca 2 (Chiều/Tối)</span>
                          {fac.ca2 === 'Đã báo cáo' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-success dark:text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-success"></span> Đã báo cáo</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-error dark:text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span> Chưa báo cáo</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {viewMode === 'kanban' ? (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
                    <KanbanColumn title="Cần làm" status="todo" tasks={filteredTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'todo'})} readOnly={isReadOnlyView} />
                    <KanbanColumn title="Đang tiến hành" status="in_progress" tasks={filteredTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'in_progress'})} readOnly={isReadOnlyView} />
                    <KanbanColumn title="Nghiệm thu" status="review" tasks={filteredTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'review'})} readOnly={isReadOnlyView} />
                    <KanbanColumn title="Hoàn thành" status="done" tasks={filteredTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'done'})} readOnly={isReadOnlyView} />
                  </div>
                ) : (
                  <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 overflow-hidden"><div className="overflow-x-auto custom-scrollbar"><table className="w-full text-sm text-left"><thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400"><tr><th className="px-6 py-4">Task</th><th className="px-6 py-4">PIC</th><th className="px-6 py-4">Deadline</th><th className="px-6 py-4">Trạng thái</th></tr></thead><tbody>
                        {filteredTasks.map(task => (
                          <tr key={task.id} onClick={() => setSelectedTask(task)} className="cursor-pointer border-b border-outline-variant dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-medium text-on-surface dark:text-white flex items-center gap-2">
                                {task.title}
                                {task.needsSupport && (
                                  <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md text-[10px] font-bold flex items-center gap-1 border border-red-200 dark:border-red-800/50">
                                    <span className="material-symbols-outlined text-[12px]">support_agent</span> Cần hỗ trợ
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500">{task.desc}</div>
                            </td>
                            <td className="px-6 py-4">{task.pic}</td>
                            <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{task.deadline}</td>
                            <td className="px-6 py-4"><StatusBadge status={task.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div></div>)}
              </>
            )}
          </div>
        </div>

        {selectedTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row border border-outline-variant dark:border-gray-800">
              <div className="flex-1 p-6 border-r border-outline-variant dark:border-gray-800 overflow-y-auto">
                <div className="flex justify-between items-start mb-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getStatusConfig(selectedTask.status).color}`}>
                    <span className="material-symbols-outlined text-[14px]">{getStatusConfig(selectedTask.status).icon}</span>
                    {getStatusConfig(selectedTask.status).label}
                  </span>
                  <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 md:hidden">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                <h2 className="text-xl font-bold text-on-surface dark:text-white mb-2 flex items-center gap-2">
                  {selectedTask.title}
                  {selectedTask.needsSupport && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md text-xs font-bold flex items-center gap-1 border border-red-200 dark:border-red-800/50">
                      <span className="material-symbols-outlined text-[14px]">support_agent</span> Cần hỗ trợ
                    </span>
                  )}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{selectedTask.desc}</p>
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
                    <span className="text-sm font-bold text-error">{selectedTask.deadline ? selectedTask.deadline.replace('T', ' lúc ') : ''}</span>
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-800">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Chuyển trạng thái Task</h3>
                  {selectedTask.status !== 'done' ? (
                    <div className="bg-surface-container dark:bg-[#252525] p-4 rounded-xl border border-dashed border-outline-variant dark:border-gray-700">
                      {user && (user.name === selectedTask.pic) ? (
                        !showClosureConfirm ? (
                          <>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                              Bạn là PIC của công việc này.
                            </p>
                            
                            {selectedTask.status === 'todo' && (
                              <button onClick={() => handleUpdateTaskStatus(selectedTask.id, 'in_progress')} className="w-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 mb-2">
                                <span className="material-symbols-outlined text-[18px]">play_arrow</span> Bắt đầu làm
                              </button>
                            )}

                            {selectedTask.status === 'in_progress' && (
                              <button onClick={() => handleUpdateTaskStatus(selectedTask.id, 'review')} className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 mb-2">
                                <span className="material-symbols-outlined text-[18px]">rate_review</span> Xin Nghiệm thu
                              </button>
                            )}

                            <button onClick={() => setShowClosureConfirm(true)} className="w-full bg-success hover:bg-success/90 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2">
                              <span className="material-symbols-outlined text-[18px]">check_circle</span> Đóng Task (Hoàn thành)
                            </button>
                          </>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Xác nhận hoàn thành?</p>
                            <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-outline-variant dark:border-gray-600 rounded-lg p-4 cursor-pointer hover:bg-surface-container-high transition-colors">
                              <span className="material-symbols-outlined text-gray-400">upload_file</span>
                              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{evidenceFile ? evidenceFile.name : 'Chọn ảnh/tài liệu...'}</span>
                              <input type="file" className="hidden" onChange={(e) => setEvidenceFile(e.target.files[0])} />
                            </label>
                            <div className="flex gap-2 pt-2">
                              <button onClick={() => { setShowClosureConfirm(false); setEvidenceFile(null); }} className="flex-1 bg-surface-container-highest dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium py-2 rounded-lg transition-colors dark:text-white">Hủy</button>
                              <button onClick={() => { handleUpdateTaskStatus(selectedTask.id, 'done', evidenceFile ? evidenceFile.name : null); setShowClosureConfirm(false); setEvidenceFile(null); }} className="flex-[2] bg-success hover:bg-success/90 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"><span className="material-symbols-outlined text-[18px]">done_all</span> Xác nhận đóng</button>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 p-3 rounded-lg text-sm"><span className="material-symbols-outlined">lock</span> <span>Chỉ PIC ({selectedTask.pic}) mới có quyền đổi trạng thái task này.</span></div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-success/10 text-success p-4 rounded-xl flex items-center gap-3 border border-success/20">
                      <span className="material-symbols-outlined text-2xl">verified</span>
                      <div><p className="font-bold text-sm">Đã đóng thành công</p><p className="text-xs opacity-80">{selectedTask.evidence ? `Có đính kèm: ${selectedTask.evidence}` : 'Không có bằng chứng đính kèm'}</p></div>
                    </div>
                  )}
                  
                  {user && user.role === 'SUPER_ADMIN' && (
                    <div className="mt-4 pt-4 border-t border-error/20 dark:border-red-900/30">
                      <button onClick={() => handleDeleteTask(selectedTask.id)} className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm">
                        <span className="material-symbols-outlined text-[18px]">delete_forever</span> Xóa vĩnh viễn
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="w-full md:w-96 flex flex-col bg-surface-container-lowest dark:bg-[#1a1a1a]">
                <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-white dark:bg-[#1e1e1e]">
                  <h3 className="font-bold text-sm flex items-center gap-2 dark:text-white"><span className="material-symbols-outlined text-primary">forum</span> Thảo luận Task (@)</h3>
                  <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hidden md:block"><span className="material-symbols-outlined">close</span></button>
                </div>
                <div id="comments-scroll-container" className="flex-1 p-4 overflow-y-auto space-y-4">
                    {selectedTaskComments.map(c => (
                      <div key={c.id} className={`flex gap-3 ${c.user_id === user.id ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${c.user_id === user.id ? 'bg-orange-500 text-white' : 'bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                          {c.user_name ? c.user_name.substring(0, 1).toUpperCase() : 'U'}
                        </div>
                        <div className={`p-3 rounded-2xl text-sm dark:text-gray-200 max-w-[85%] ${c.user_id === user.id ? 'bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-100 rounded-tr-none border border-orange-200 dark:border-orange-800/50' : 'bg-gray-100 text-gray-800 dark:bg-[#2a2a2a] rounded-tl-none border border-outline-variant dark:border-gray-800'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-[11px]">{c.user_name ? c.user_name : 'Người dùng hệ thống'}</span>
                            {c.user_role && <span className="text-[9px] bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-full text-gray-700 dark:text-gray-300">{c.user_role}</span>}
                          </div>
                          <div className="break-words leading-relaxed text-[13px]">{c.content}</div>
                          <span className="text-[9px] opacity-60 block mt-1 text-right">
                            {new Date(c.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(', ', ' - ')}
                          </span>
                        </div>
                      </div>
                    ))}
                    {selectedTaskComments.length === 0 && (
                      <div className="text-center text-gray-400 text-sm italic mt-4">Chưa có bình luận nào.</div>
                    )}
                  </div>
                <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-white dark:bg-[#1e1e1e] relative">
                  {showMentionMenu && (
                    <div className="absolute bottom-full left-0 w-full mb-2 bg-white dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl shadow-lg max-h-48 overflow-y-auto z-10 p-2">
                      {(() => {
                        const dbUsers = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
                        const specialMentions = [
                          { user_id: 'all', full_name: 'All (Tất cả)', email: 'Nhắc tất cả mọi người' },
                          { user_id: 'hq', full_name: 'Sếp Tổng', email: 'Ban Giám Đốc' },
                          { user_id: 'vp', full_name: 'Sếp Phó', email: 'Ban Giám Đốc' },
                          { user_id: 'acc', full_name: 'Phòng Kế toán', email: 'Bộ phận tài chính' },
                          { user_id: 'mkt', full_name: 'Phòng Truyền thông', email: 'Bộ phận truyền thông' }
                        ];
                        const allOptions = [...specialMentions, ...dbUsers];
                        return allOptions
                          .filter(u => u.full_name && (u.full_name.toLowerCase().includes(mentionFilter) || (u.email && u.email.toLowerCase().includes(mentionFilter))))
                          .map((u, idx) => (
                            <div key={u.user_id || idx} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer rounded-lg text-sm dark:text-white" onClick={() => {
                              const textBeforeCursor = chatInput.substring(0, cursorPosition);
                              const textAfterCursor = chatInput.substring(cursorPosition);
                              const match = textBeforeCursor.match(/@([^@]*)$/);
                              if (match) {
                                  const replaceStart = cursorPosition - match[0].length;
                                  const newText = chatInput.substring(0, replaceStart) + '@' + (u.user_id === 'all' ? 'all' : u.full_name) + ' ' + textAfterCursor;
                                  setChatInput(newText);
                              }
                              setShowMentionMenu(false);
                              setTimeout(() => document.getElementById('task-chat-input')?.focus(), 0);
                            }}>
                              <div className="font-medium text-primary">{u.full_name}</div>
                              <div className="text-xs text-gray-500">{u.email}</div>
                            </div>
                          ));
                      })()}
                    </div>
                  )}
                  <div className="relative">
                    <input id="task-chat-input" type="text" value={chatInput} 
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          document.getElementById('send-comment-btn').click();
                        }
                      }}
                      onChange={(e) => {
                      const val = e.target.value;
                      setChatInput(val);
                      const pos = e.target.selectionStart;
                      setCursorPosition(pos);
                      const textBeforeCursor = val.substring(0, pos);
                      const match = textBeforeCursor.match(/@([^@]*)$/);
                      if (match) {
                          setShowMentionMenu(true);
                          setMentionFilter(match[1].toLowerCase());
                      } else {
                          setShowMentionMenu(false);
                      }
                    }} placeholder="Gõ @ để tag tên..." className="w-full pl-4 pr-10 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none dark:text-white" />
                    <button id="send-comment-btn" onClick={async () => {
                      if (!chatInput.trim()) return;
                      // Lấy ID an toàn
                      const taskId = selectedTask?.id || selectedTask?.task_id;
                      console.log("DEBUG taskId trước khi gửi comment:", taskId);
                      if (!taskId || taskId === 'undefined') {
                          console.error("Lỗi: Không tìm thấy ID của task đang mở!");
                          return;
                      }
                      
                      try {
                        const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/comments`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
                            'x-user-id': user.id,
                            'x-user-role': user.role,
                            'x-facility-id': user.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user.facility_id) ? user.facility_id.join(',') : user.facility_id)
                          },
                          body: JSON.stringify({ content: chatInput })
                        });
                        const data = await res.json();
                        if ((res.status === 200 || res.status === 201) && data.success) {
                          setChatInput('');
                          // CẬP NHẬT GIAO DIỆN KHI BACKEND ĐÃ TRẢ VỀ DATA THÀNH CÔNG
                          setSelectedTaskComments(prev => [...prev, data.data]);
                          
                          setTasks(tasks.map(t => t.id === selectedTask.id ? { ...t, comment_count: parseInt(t.comment_count || t.comments_count || 0) + 1, comments_count: parseInt(t.comment_count || t.comments_count || 0) + 1, latest_comment: chatInput, latest_comment_user_id: user.id } : t));
                          setTimeout(() => {
                            const el = document.getElementById('comments-scroll-container');
                            if (el) el.scrollTop = el.scrollHeight;
                          }, 100);
                        }
                      } catch(e) { console.error('Error posting comment', e); }
                    }} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:text-primary/80 p-1 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[20px]">send</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAITaskModal && (
          <AITaskModal onClose={() => setShowAITaskModal(false)} onConfirm={handleAITaskConfirm} user={user} />
        )}

        {showChangePasswordModal && (
          <ChangePasswordModal 
            user={user} 
            onClose={() => setShowChangePasswordModal(false)} 
            onSuccess={logout} 
          />
        )}

        {showCreateModal && (
          <TaskCreationModal onClose={() => setShowCreateModal(false)} onSave={handleCreateTask} defaultStatus={createModalStatus} user={user} />
        )}

        {toastMessage && (
          <div className="fixed bottom-6 right-6 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-fade-in z-50">
            <span className="material-symbols-outlined text-success dark:text-green-600">check_circle</span>
            <span className="text-sm font-medium">{toastMessage}</span>
          </div>
        )}

      </main>

      {/* Right Sidebar Disabled */}
      {false && (
        <aside className="w-80 bg-white dark:bg-[#1e1e1e] border-l border-outline-variant dark:border-gray-800 flex flex-col shadow-xl z-20 transition-colors">
          <div className="p-6 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-secondary/5 to-transparent">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display font-bold text-secondary dark:text-purple-400 flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
                Cố vấn AI
              </h3>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary"></span>
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Giám sát & đôn đốc tiến độ toàn chuỗi</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {AI_INSIGHTS.map(insight => (
              <div key={insight.id} className="p-4 rounded-xl border border-secondary/20 bg-secondary/5 dark:bg-secondary/10 hover:border-secondary/40 transition-colors group cursor-pointer">
                <div className="flex items-start gap-3">
                  <span className={`material-symbols-outlined mt-0.5 text-[20px] ${insight.type === 'warning' ? 'text-error' : 'text-secondary dark:text-purple-400'}`}>
                    {insight.type === 'warning' ? 'warning' : 'insights'}
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-on-surface dark:text-white mb-1">{insight.title}</h4>
                    <p className="text-xs text-on-surface-variant dark:text-gray-300 leading-relaxed mb-3">{insight.desc}</p>
                    <button className="text-xs font-semibold text-secondary dark:text-purple-400 hover:underline flex items-center gap-1">
                      {insight.type === 'warning' ? 'Gửi AI Ping' : 'Xem chi tiết'}
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="p-4 rounded-xl border border-dashed border-primary/30 bg-primary/5 dark:bg-primary/10 flex flex-col items-center text-center mt-6">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary dark:text-blue-400 mb-2">
                <span className="material-symbols-outlined">document_scanner</span>
              </div>
              <h4 className="text-sm font-semibold dark:text-white">AI Tạo Việc Tự động</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">Tự động tạo task từ biên bản họp.</p>
              <button className="bg-white dark:bg-gray-800 border border-outline-variant dark:border-gray-700 text-xs px-3 py-1.5 rounded-lg shadow-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Tải lên File
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

// 2. Wrap App bằng Auth Provider
export default function AppContainer() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Removed hardcoded Migration script per Architect's order

    let localFacs = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
    if (localFacs.length === 0) {
      localFacs = [
        { id: 'f1', name: 'DUBAI 41', is_active: true },
        { id: 'f2', name: 'DUBAI ACE', is_active: true },
        { id: 'f3', name: 'DUBAI PA', is_active: true },
        { id: 'f4', name: 'DUBAI PAK', is_active: true },
        { id: 'f5', name: 'DUBAI PAV', is_active: true },
        { id: 'f6', name: 'DUBAI PQ', is_active: true }
      ];
      localStorage.setItem('taskflow_facilities', JSON.stringify(localFacs));
    }
    const authData = localStorage.getItem('taskflow_auth');
    if (authData) {
      try {
        const parsed = JSON.parse(authData);
        if (parsed && parsed.user) {
          if (parsed.user.role) {
            parsed.user.role = parsed.user.role.trim().toUpperCase();
          }
          if (parsed.token) {
            localStorage.setItem('taskflow_token', parsed.token);
          }
          setUser(parsed.user);
        }
      } catch (e) { }
    }
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    if (userData && userData.role) {
      userData.role = userData.role.trim().toUpperCase();
    }
    localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: userData }));
    if (token) {
        localStorage.setItem('taskflow_token', token);
        localStorage.setItem('token', token);
    }
    setUser(userData);
    fetchSystemConfig();
    fetchKPIs();
  };

  const logout = () => {
    localStorage.removeItem('taskflow_auth');
    localStorage.removeItem('taskflow_token');
    localStorage.removeItem('token');
    setUser(null);
  };

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {user ? <MainDashboard /> : <Login />}
    </AuthContext.Provider>
  );
}

// Sub components
function NavItem({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${active ? 'bg-primary/10 dark:bg-primary/20 text-primary dark:text-blue-400 font-semibold' : 'text-on-surface-variant dark:text-gray-400 hover:bg-surface-variant dark:hover:bg-gray-800 hover:text-on-surface dark:hover:text-gray-200'}`}>
      <span className="material-symbols-outlined text-[20px]">{icon}</span>
      {label}
    </button>
  );
}


function StatusBadge({ status }) {
  const styles = { todo: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700', in_progress: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800', review: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800', done: 'bg-success-container text-success dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800' };
  const labels = { todo: 'Cần làm', in_progress: 'Đang tiến hành', review: 'Nghiệm thu', done: 'Hoàn thành' };
  return <span className={`whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status]}`}>{labels[status]}</span>;
}

function KanbanColumn({ title, status, tasks, setSelectedTask, onOpenCreateModal, onQuickAdd, readOnly }) {
  const columnTasks = tasks.filter(t => t.status === status);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const inputRef = React.useRef(null);

  useEffect(() => {
    if (showQuickAdd && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showQuickAdd]);

  const handleQuickSubmit = () => {
    if (quickTitle.trim() && !readOnly) {
      onQuickAdd({ title: quickTitle, desc: '', status });
      setQuickTitle('');
    }
    setShowQuickAdd(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleQuickSubmit();
    if (e.key === 'Escape') setShowQuickAdd(false);
  };

  return (
    <div className="bg-surface-container-low dark:bg-[#1e1e1e] rounded-2xl flex flex-col max-h-full border border-outline-variant dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-[#252525]">
        <h3 className="font-bold text-on-surface dark:text-white flex items-center gap-2">
          {title}
          <span className="bg-white dark:bg-gray-800 text-xs py-0.5 px-2 rounded-full border border-gray-200 dark:border-gray-700 shadow-sm text-gray-500">{columnTasks.length}</span>
        </h3>
        <button className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><span className="material-symbols-outlined text-[18px]">more_horiz</span></button>
      </div>
      <div className="p-3 flex-1 overflow-y-auto space-y-3 custom-scrollbar bg-gray-50/30 dark:bg-transparent min-h-[150px]">
        {columnTasks.map(task => (
          <div key={task.id} onClick={() => setSelectedTask(task)} className="bg-white dark:bg-[#252525] p-4 rounded-xl shadow-sm border border-outline-variant dark:border-gray-700 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group">
            <div className="mb-2 flex items-center justify-between">
              {(task.facility || task.department_tag) ? (
                <span className="text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary px-2 py-0.5 rounded-md">{task.facility || task.department_tag}</span>
              ) : <div />}
              <div className="flex">
                {task.priority_stars === 3 && (
                  <>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  </>
                )}
                {task.priority_stars === 2 && (
                  <>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  </>
                )}
              </div>
            </div>
            <h4 className="font-medium text-sm text-on-surface dark:text-white mb-2 leading-snug group-hover:text-primary transition-colors">{task.title}</h4>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-surface-container-highest dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center justify-center text-[10px] font-bold border border-white dark:border-gray-600 shadow-sm">
                  {task.pic ? task.pic.split(' ').map(n => n[0]).join('').slice(0, 2) : '?'}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{task.pic || 'Chưa giao'}</span>
              </div>
              <div className="flex items-center gap-1 text-gray-400 hover:text-secondary transition-colors" title="Thảo luận (Task-Chat)">
                <span className="material-symbols-outlined text-[16px]">forum</span>
                <span className="text-xs">{task.comment_count || 0}</span>
              </div>
            </div>
          </div>
        ))}

        {columnTasks.length === 0 && !showQuickAdd && <div className="text-center p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-gray-400 text-xs">Trống</div>}
        
        {showQuickAdd && !readOnly && (
          <div className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-primary dark:border-blue-500">
            <input ref={inputRef} type="text" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => quickTitle.trim() ? handleQuickSubmit() : setShowQuickAdd(false)} placeholder="Nhập tiêu đề (Enter để lưu)..." className="w-full text-sm outline-none bg-transparent dark:text-white" />
          </div>
        )}

        {!showQuickAdd && !readOnly && (
          <div className="flex gap-2 mt-2">
            <button onClick={() => setShowQuickAdd(true)} className="flex-1 py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700" title="Quick Add">
              <span className="material-symbols-outlined text-[18px]">bolt</span>
            </button>
            <button onClick={() => onOpenCreateModal(status)} className="flex-[3] py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700">
              <span className="material-symbols-outlined text-[18px] mr-1">add</span> Thêm
            </button>
          </div>
        )}
      </div>
    </div>
  );
}












