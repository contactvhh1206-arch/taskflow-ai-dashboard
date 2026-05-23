import React, { useState, useEffect, createContext, useContext } from 'react';
import Login from './components/Login.jsx';
import DailyCheckin from './components/DailyCheckin.jsx';
import AITaskModal from './components/AITaskModal.jsx';
import AIAdvisor from './components/AIAdvisor.jsx';
import ChangePasswordModal from './components/ChangePasswordModal.jsx';

// 1. Khởi tạo Auth Context
export const AuthContext = createContext();

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

function MainDashboard() {
  const { user, logout } = useContext(AuthContext);
  const [viewMode, setViewMode] = useState('kanban');
  const [darkMode, setDarkMode] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');
  const [tasks, setTasks] = useState([]);
  const [facilityStatuses, setFacilityStatuses] = useState([]);
  const [isCheckinCompleted, setIsCheckinCompleted] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAITaskModal, setShowAITaskModal] = useState(false);
  const [showClosureConfirm, setShowClosureConfirm] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalStatus, setCreateModalStatus] = useState('todo');
  const [toastMessage, setToastMessage] = useState('');
  
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
  }, [user, timeFilter]); // Fetch when timeFilter changes

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleAITaskConfirm = (draftTasks) => {
    if (draftTasks && draftTasks.length > 0) {
      setTasks([...tasks, ...draftTasks]);
      showToast(`Đã tạo thành công ${draftTasks.length} công việc từ biên bản.`);
    }
  };

  const handleCreateTask = (newTask) => {
    setTasks([...tasks, {
      id: Date.now(),
      pic: user.name,
      deadline: new Date().toISOString().split('T')[0],
      urgent: false,
      facility: user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id,
      ...newTask
    }]);
  };

  useEffect(() => {
    if (user) {
      if (user.role === 'FACILITY_MANAGER') {
        setTasks(INITIAL_TASKS.filter(t => t.facility === user.facility_id));
      } else {
        setTasks(INITIAL_TASKS);
      }
      fetchFacilityStatuses();
    }
  }, [user]);

  const fetchFacilityStatuses = async () => {
    try {
      const response = await fetch('https://taskflow-ai-dashboard.onrender.com/api/checkin/status', {
        headers: { 'x-user-role': user.role, 'x-facility-id': user.facility_id || 'ALL' }
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
          <NavItem icon="dashboard" label="Tổng quan" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon="assignment" label="Công việc" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
          {user.role === 'FACILITY_MANAGER' && (
            <NavItem icon="fact_check" label="Điểm danh" active={activeTab === 'checkin'} onClick={() => setActiveTab('checkin')} />
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
          <button onClick={() => setShowChangePasswordModal(true)} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors mb-2">
            <span className="material-symbols-outlined">key</span> Đổi mật khẩu
          </button>
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
                <AIAdvisor />
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
                    <KanbanColumn title="Cần làm" status="todo" tasks={tasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'todo'})} />
                    <KanbanColumn title="Đang tiến hành" status="in_progress" tasks={tasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'in_progress'})} />
                    <KanbanColumn title="Nghiệm thu" status="review" tasks={tasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'review'})} />
                    <KanbanColumn title="Hoàn thành" status="done" tasks={tasks} setSelectedTask={setSelectedTask} onOpenCreateModal={(s) => { setCreateModalStatus(s); setShowCreateModal(true); }} onQuickAdd={(t) => handleCreateTask({...t, status: 'done'})} />
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
                        {tasks.map(task => (
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
                <h2 className="text-xl font-bold text-on-surface dark:text-white mb-2">{selectedTask.title}</h2>
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
                    <span className="text-sm font-bold text-error">{selectedTask.deadline}</span>
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-800">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Chuyển trạng thái (Đóng Task)</h3>
                  {selectedTask.status !== 'done' ? (
                    <div className="bg-surface-container dark:bg-[#252525] p-4 rounded-xl border border-dashed border-outline-variant dark:border-gray-700">
                      {user && user.name === selectedTask.pic ? (
                        !showClosureConfirm ? (
                          <>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Chỉ bạn (PIC) mới có quyền đóng công việc này.</p>
                            <button onClick={() => setShowClosureConfirm(true)} className="w-full bg-success hover:bg-success/90 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2">
                              <span className="material-symbols-outlined text-[18px]">check_circle</span> Hoàn thành
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
                              <button onClick={() => { setTasks(tasks.map(t => t.id === selectedTask.id ? {...t, status: 'done', evidence: evidenceFile ? evidenceFile.name : null} : t)); setSelectedTask({...selectedTask, status: 'done', evidence: evidenceFile ? evidenceFile.name : null}); setShowClosureConfirm(false); setEvidenceFile(null); }} className="flex-[2] bg-success hover:bg-success/90 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"><span className="material-symbols-outlined text-[18px]">done_all</span> Xác nhận đóng</button>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 p-3 rounded-lg text-sm"><span className="material-symbols-outlined">lock</span> <span>Chỉ PIC ({selectedTask.pic}) mới có quyền đóng task này.</span></div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-success/10 text-success p-4 rounded-xl flex items-center gap-3 border border-success/20">
                      <span className="material-symbols-outlined text-2xl">verified</span>
                      <div><p className="font-bold text-sm">Đã đóng thành công</p><p className="text-xs opacity-80">{selectedTask.evidence ? `Có đính kèm: ${selectedTask.evidence}` : 'Không có bằng chứng đính kèm'}</p></div>
                    </div>
                  )}
                </div>
              </div>
              <div className="w-full md:w-96 flex flex-col bg-surface-container-lowest dark:bg-[#1a1a1a]">
                <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-white dark:bg-[#1e1e1e]">
                  <h3 className="font-bold text-sm flex items-center gap-2 dark:text-white"><span className="material-symbols-outlined text-primary">forum</span> Thảo luận Task (@)</h3>
                  <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hidden md:block"><span className="material-symbols-outlined">close</span></button>
                </div>
                <div className="flex-1 p-4 overflow-y-auto space-y-4">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">AD</div>
                    <div className="bg-surface-container dark:bg-[#2a2a2a] p-3 rounded-2xl rounded-tl-none text-sm dark:text-gray-200"><span className="text-primary font-bold text-[11px] block mb-1">Admin Tổng</span> Nhớ kiểm tra kỹ task này nhé, Sếp đang hối.</div>
                  </div>
                </div>
                <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-white dark:bg-[#1e1e1e]">
                  <div className="relative">
                    <input type="text" placeholder="Gõ @ để tag tên..." className="w-full pl-4 pr-10 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none dark:text-white" />
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:text-primary/80 p-1 flex items-center justify-center">
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

      {/* Right Sidebar (SUPER_ADMIN Only) */}
      {user.role === 'SUPER_ADMIN' && (
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
    const authData = localStorage.getItem('taskflow_auth');
    if (authData) {
      try {
        const parsed = JSON.parse(authData);
        if (parsed && parsed.user) setUser(parsed.user);
      } catch (e) { }
    }
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: userData }));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('taskflow_auth');
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
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status]}`}>{labels[status]}</span>;
}

function KanbanColumn({ title, status, tasks, setSelectedTask, onOpenCreateModal, onQuickAdd }) {
  const columnTasks = tasks.filter(t => t.status === status);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const inputRef = React.useRef(null);

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

  return (
    <div className="flex flex-col bg-surface-container dark:bg-[#1a1a1a] rounded-xl border border-outline-variant dark:border-gray-800/50 p-4 min-h-[500px]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
          {title} <span className="bg-white dark:bg-gray-800 border border-outline-variant dark:border-gray-700 text-gray-500 px-2 py-0.5 rounded-full text-xs">{columnTasks.length}</span>
        </h3>
        <button className="text-gray-400 hover:text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">more_horiz</span></button>
      </div>
      <div className="flex flex-col gap-3">
        {columnTasks.map(task => (
          <div key={task.id} onClick={() => setSelectedTask(task)} className="bg-white dark:bg-[#252525] p-4 rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary dark:text-blue-400 bg-primary/10 dark:bg-primary/20 px-2 py-1 rounded-md">{task.facility}</span>
              {task.urgent && <span className="material-symbols-outlined text-error text-[16px]" title="Khẩn cấp">error</span>}
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
                <span className="text-xs">0</span>
              </div>
            </div>
          </div>
        ))}

        {columnTasks.length === 0 && !showQuickAdd && <div className="text-center p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-gray-400 text-xs">Trống</div>}
        
        {showQuickAdd && (
          <div className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-primary dark:border-blue-500">
            <input ref={inputRef} type="text" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => quickTitle.trim() ? handleQuickSubmit() : setShowQuickAdd(false)} placeholder="Nhập tiêu đề (Enter để lưu)..." className="w-full text-sm outline-none bg-transparent dark:text-white" />
          </div>
        )}

        {!showQuickAdd && (
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

