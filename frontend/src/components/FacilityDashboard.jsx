import React, { useState, useEffect, useRef } from 'react';
import AIAdvisor from './AIAdvisor';

export default function FacilityDashboard({ user, tasks, onOpenTask, globalFacilityFilter }) {
      const [stats, setStats] = useState({ open: 0, closed: 0, overdue: 0, total: -1, error: false });
      const [urgentTasks, setUrgentTasks] = useState([]);
      const [aiPings, setAiPings] = useState([]);
      const [recentLogs, setRecentLogs] = useState([]);
      const [timeFilter, setTimeFilter] = useState('today');
      const [isLoading, setIsLoading] = useState(false);
      const [localFacFilter, setLocalFacFilter] = useState('ALL');
      const [facilitiesList] = useState(() => JSON.parse(localStorage.getItem('taskflow_facilities') || '[]'));
      const hasPingedAI = useRef(false); // 1. Tạo cờ khóa vĩnh viễn cho session hiện tại
      const handleRequestSupport = async (taskId) => {
        try {
          const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/support`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'x-user-role': user?.role,
              'x-facility-id': localStorage.getItem('facility_id') || user?.facility_id || 'ALL'
            }
          });
          if (!res.ok) throw new Error('API Error');
          const data = await res.json();
          if (data.success) {
            if (window.showToast) window.showToast('Đã gửi yêu cầu hỗ trợ đến Ban Giám Đốc!', 'success');
            
            // Push Notification to Local Storage
            const newNotif = {
              title: 'Yêu cầu hỗ trợ mới',
              message: `Cơ sở ${user?.facility_id || 'chưa rõ'} cần hỗ trợ cho công việc #${taskId}`,
              time: new Date().toLocaleTimeString('vi-VN')
            };
            const notifs = JSON.parse(localStorage.getItem('taskflow_notifications') || '[]');
            localStorage.setItem('taskflow_notifications', JSON.stringify([newNotif, ...notifs]));
            window.dispatchEvent(new Event('taskflow_notify'));

            // Update local task state visually
            setAiPings(prev => prev.map(p => p.task.id === taskId ? { ...p, task: { ...p.task, needsSupport: true } } : p));
          } else {
            if (window.showToast) window.showToast('Lỗi gửi yêu cầu hỗ trợ', 'error');
          }
        } catch (error) {
          console.error("Lỗi:", error);
          if (window.showToast) window.showToast('Lỗi máy chủ khi gửi yêu cầu', 'error');
        }
      };

      useEffect(() => {
        // Chỉ hiện Loading khi chưa có data (Ngăn chặn Flicker chớp màn hình khi re-render)
        if (stats.total === -1) {
          setIsLoading(true);
        }
        const timer = setTimeout(async () => {
          try {
            // Safe array fallback and Row-level security
            const safeTasks = Array.isArray(tasks) ? tasks : [];
            const isHighLevel = user?.role !== 'DEPARTMENT_HEAD' && (user?.facility_id === 'ALL' || (Array.isArray(user?.facility_id) && user?.facility_id.includes('ALL')) || ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user?.role));
            const rawFac = user?.facility_code || user?.facility_id || '';
            const facCode = (Array.isArray(rawFac) ? rawFac.join(',') : String(rawFac)).toLowerCase();
            const isVP = user?.role === 'VICE_PRESIDENT';
            const isDeptHead = ['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role) || isVP;
            const deptId = user?.department_id || (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : (isVP ? 'BGD' : 'MARKETING'));
            
            const myTasks = safeTasks.filter(t => {
               if (isHighLevel && globalFacilityFilter === 'ALL') return true;
               if (isHighLevel && globalFacilityFilter !== 'ALL') {
                   const tTitle = (t.title || '').toLowerCase();
                   const tFacName = (t?.facilityId || t?.facility || '').toLowerCase();
                   const tDeptTag = (t?.department_tag || '').toLowerCase();
                   const filterLower = globalFacilityFilter.toLowerCase();
                   return tFacName.includes(filterLower) || tTitle.includes(filterLower) || tDeptTag === filterLower;
               }
               
               if (isDeptHead) {
                  const tFacCode = String(t?.facility || t?.facilityId || '').toLowerCase();
                    if (globalFacilityFilter === 'ALL') { return (t?.department_tag === deptId) || tFacCode.includes(String(deptId).toLowerCase()); }
                  if (globalFacilityFilter && globalFacilityFilter !== 'ALL' && globalFacilityFilter !== deptId) {
                      const filterLower = String(globalFacilityFilter).toLowerCase();
                      return tFacCode.includes(filterLower);
                  }
  
                  let matchesDept = (t.department_tag === deptId) || tFacCode.includes(String(deptId).toLowerCase());
                  if (!matchesDept) return false;
                  
                  return true;
               }
               
               if (!t) return false;
               const matchCode = String(t.facilityId || '').toLowerCase().includes(facCode);
               const matchName = String(t.facility || '').toLowerCase().includes(facCode);
               return matchCode || matchName;
            });

            const now = new Date();
            let startOfFrame = new Date();
            let endOfFrame = new Date();

            if (timeFilter === 'today') {
              startOfFrame.setHours(0,0,0,0);
              endOfFrame.setHours(23,59,59,999);
            } else if (timeFilter === 'week') {
              const day = now.getDay() || 7;
              startOfFrame.setDate(now.getDate() - day + 1);
              startOfFrame.setHours(0,0,0,0);
              endOfFrame = new Date(startOfFrame);
              endOfFrame.setDate(endOfFrame.getDate() + 6);
              endOfFrame.setHours(23,59,59,999);
            } else if (timeFilter === 'month') {
              startOfFrame.setDate(1);
              startOfFrame.setHours(0,0,0,0);
              endOfFrame = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            }

            const startMs = startOfFrame.getTime();
            const endMs = endOfFrame.getTime();

            const getCreatedTime = (t) => {
              try {
                if (t?.historyLog?.length > 0) {
                  const match = t.historyLog[0]?.time?.match(/(\d+):(\d+) - (\d+)\/(\d+)\/(\d+)/);
                  if (match) return new Date(match[5], match[4] - 1, match[3], match[1], match[2]).getTime();
                }
              } catch (e) { }
              return now.getTime();
            };

            const getCompletedTime = (t) => {
              if (t?.completedAtReal) return new Date(t.completedAtReal).getTime();
              if (t?.completedAt) return new Date(t.completedAt).getTime();
              return t?.deadline ? new Date(t.deadline).getTime() : now.getTime();
            };

            const getDeadlineTime = (t) => {
              if (!t?.deadline || typeof t.deadline !== 'string') return 0;
              const [y, m, d] = t.deadline.split('-');
              if (!y || !m || !d) return 0;
              return new Date(y, m - 1, d, 23, 59, 59).getTime();
            };

            const openCount = myTasks.filter(t => {
              if (t?.status === 'done' || t?.status === 'revoked') return false;
              const cTime = getCreatedTime(t);
              return cTime >= startMs && cTime <= endMs;
            }).length;

            const closedCount = myTasks.filter(t => {
              if (t?.status !== 'done') return false;
              const compTime = getCompletedTime(t);
              return compTime >= startMs && compTime <= endMs;
            }).length;

            const overdueCount = myTasks.filter(t => {
              const dTime = getDeadlineTime(t);
              if (dTime === 0) return false;
              if (dTime < startMs || dTime > endMs) return false;

              if (t?.status !== 'done' && t?.status !== 'revoked') {
                return dTime < now.getTime();
              }
              if (t?.status === 'done') {
                const compTime = getCompletedTime(t);
                return compTime > dTime;
              }
              return false;
            }).length;

            setStats({ open: openCount ?? 0, closed: closedCount ?? 0, overdue: overdueCount ?? 0, total: myTasks.length });

            const todayStr = new Date().toISOString().split('T')[0];
            const urgent = myTasks.filter(t => t?.status !== 'done' && t?.status !== 'revoked' && (t?.urgent || t?.pinned || (t?.deadline && t.deadline <= todayStr)));
            setUrgentTasks(urgent || []);

            // AI Pings now handled by a separate useEffect with useRef lock to call Node API

          } catch (err) {
            console.error("Dashboard calculation error:", err);
            setStats({ error: true });
          } finally {
            setIsLoading(false);
          }
        }, 50); // Giảm latency ảo xuống 50ms để tối ưu tốc độ UI

        return () => clearTimeout(timer);
      }, [tasks, timeFilter, user?.id, user?.facility_id, user?.facility_name, globalFacilityFilter, localFacFilter]);

      // --- TÁCH LUỒNG API ĐỂ TRÁNH INFINITE LOOP ---
      useEffect(() => {
         const loadRecentLogs = async () => {
            if (window.DataService) {
              try {
                const history = await window.DataService.fetchHistory({ entry_type: 'Operation_Log' });
                let filteredLogs = history;
                if (['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role)) {
                   const deptId = user?.department_id || (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : (user?.username === 'marketing' ? 'MARKETING' : 'ALL'));
                   filteredLogs = history.filter(h => h.org_unit === deptId);
                } else {
                   const facFilter = globalFacilityFilter === 'ALL' ? '' : globalFacilityFilter;
                   filteredLogs = facFilter ? history.filter(h => h.org_unit === facFilter || h.org_unit === user?.facility_id) : history;
                }
                setRecentLogs(filteredLogs.slice(0, 10));
              } catch (e) {
                console.error("Error loading logs", e);
              }
            }
         };
         loadRecentLogs();
      }, [user?.id, user?.role, user?.department_id, user?.username, user?.facility_id, globalFacilityFilter]);

      // --- BƯỚC 1 & 2: ENGINE AI PING GỌI BATCH API VỀ NODE.JS ---
      useEffect(() => {
        // 2. Kiểm tra điều kiện: Nếu chưa có tasks, user, hoặc ĐÃ PING RỒI thì dừng ngay!
        if (!user?.id || !tasks || tasks.length === 0 || hasPingedAI.current) return;

        const runAIPing = async () => {
          // 3. Khóa chết cờ NGAY LẬP TỨC trước khi gọi API
          hasPingedAI.current = true; 
          
          try {
            console.log("[OpenRouter API Call] System Prompt Ping...");
            
            const topUrgent = tasks.filter(t => t?.status !== 'done' && t?.status !== 'revoked' && (t?.urgent || t?.pinned)).slice(0, 3);
            if (topUrgent.length === 0) return;
            
            const taskIds = topUrgent.map(t => t.id);
            const token = localStorage.getItem('token') || localStorage.getItem('taskflow_token');
            
            const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/ai/ping-batch`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ taskIds }) 
            });
            
            if (res.ok) {
              const data = await res.json();
              if (data.success && data.data) {
                const formattedPings = data.data.map((pingRes, idx) => ({
                  id: `ping-${pingRes.taskId}-${idx}`,
                  task: topUrgent.find(t => t.id === pingRes.taskId) || topUrgent[0],
                  message: pingRes.generated_message,
                  time: 'Vừa xong'
                }));
                setAiPings(formattedPings);
                return;
              }
            }
          } catch (error) {
             console.error("Lỗi AI Ping:", error);
          }
          
          // FALLBACK NẾU LỖI MẠNG HOẶC API THẤT BẠI
          const topUrgent = tasks.filter(t => t?.status !== 'done' && t?.status !== 'revoked' && (t?.urgent || t?.pinned)).slice(0, 3);
          const fallbackPings = topUrgent.map((t, idx) => {
            const prompts = JSON.parse(localStorage.getItem('taskflow_system_prompts') || '{}');
            const empatheticPingTemplate = prompts.empatheticPing || 'Tôi thấy công việc "[TASK_TITLE]" đang tới hạn. Bạn có cần hỗ trợ điều phối thêm nhân sự không? Đừng quá áp lực nhé!';
            const msg = empatheticPingTemplate.replace("[TASK_TITLE]", t.title);
            console.log("[OpenRouter API Call] System Prompt Ping:", msg);
            return {
              id: `ping-${t.id}-${idx}-fallback`,
              task: t,
              message: msg,
              time: 'Vừa xong'
            };
          });
          setAiPings(fallbackPings);
        };

        // Chạy hàm
        runAIPing();

      }, [user?.id, tasks]);
      // ------------------------------------------
      if (isLoading) {
        return (
          <div className="space-y-6 animate-fade-in">
            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-64 animate-pulse"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-48 mt-2 animate-pulse"></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-outline-variant dark:border-gray-800 h-32 animate-pulse flex flex-col justify-between">
                  <div className="w-1/2 h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="w-1/3 h-8 bg-gray-200 dark:bg-gray-700 rounded mt-4"></div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-6 animate-fade-in">
          <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-on-surface dark:text-white">
                {['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role)
                  ? `Bảng tin công việc - ${user?.department || (user?.role === 'FINANCE_DEPT' ? 'Phòng Kế Toán' : 'Phòng Truyền Thông')}` 
                  : ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user?.role)
                    ? `Tổng quan - ${globalFacilityFilter === 'ALL' ? 'Tất cả cơ sở & Phòng ban' : (globalFacilityFilter || 'Tất cả cơ sở & Phòng ban')}`
                    : `Tổng quan - ${user?.facility_name || user?.facility_code || user?.facility_id || 'Tất cả cơ sở'}`}
                </h2>
              <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">
                {['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role) ? 'Dữ liệu Real-time nội bộ phòng ban.' : 'Dữ liệu Real-time nội bộ cơ sở.'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Segmented Control: Time Filter */}
              <div className="flex items-center bg-surface-container-high dark:bg-[#252525] rounded-lg p-1 w-fit shadow-inner border border-outline-variant dark:border-gray-800">
              <button
                onClick={() => setTimeFilter('today')}
                className={`px-5 py-1.5 text-sm font-medium rounded-md transition-all duration-300 ${timeFilter === 'today'
                    ? 'bg-primary text-white shadow-md'
                    : 'text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-white'
                  }`}
              >
                Hôm nay
              </button>
              <button
                onClick={() => setTimeFilter('week')}
                className={`px-5 py-1.5 text-sm font-medium rounded-md transition-all duration-300 ${timeFilter === 'week'
                    ? 'bg-primary text-white shadow-md'
                    : 'text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-white'
                  }`}
              >
                Tuần này
              </button>
              <button
                onClick={() => setTimeFilter('month')}
                className={`px-5 py-1.5 text-sm font-medium rounded-md transition-all duration-300 ${timeFilter === 'month'
                    ? 'bg-primary text-white shadow-md'
                    : 'text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-white'
                  }`}
              >
                Tháng này
              </button>
            </div>
          </div>
        </div>

          {stats.error ? (
            <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-[#1e1e1e] rounded-2xl border border-dashed border-red-300 dark:border-red-800/50 text-red-500 mt-6 shadow-sm">
              <span className="material-symbols-outlined text-[48px] mb-4">error</span>
              <span className="text-lg font-medium">Không thể tải dữ liệu bảng tin lúc này. Vui lòng thử lại</span>
            </div>
          ) : stats.total === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-[#1e1e1e] rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 text-gray-400 mt-6 shadow-sm">
              <span className="material-symbols-outlined text-[48px] text-gray-300 dark:text-gray-600 mb-4">inbox</span>
              <span className="text-lg font-medium text-gray-500 dark:text-gray-400">Chưa có dữ liệu</span>
              <p className="text-sm mt-2 text-gray-400">Thử thay đổi bộ lọc thời gian hoặc cơ sở để xem dữ liệu.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between transition-colors">
                  <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-blue-500">pending_actions</span> Công việc Mở</h3>
                  <div className="h-10 flex items-center">
                    {isLoading ? (
                      <div className="animate-pulse h-10 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    ) : stats.error ? (
                      <span className="text-sm font-medium text-red-500">Lỗi tải dữ liệu</span>
                    ) : (
                      <p className="text-4xl font-bold text-gray-800 dark:text-white animate-fade-in">{stats.open}</p>
                    )}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between transition-colors">
                  <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-green-500">check_circle</span> Công việc Hoàn thành</h3>
                  <div className="h-10 flex items-center">
                    {isLoading ? (
                      <div className="animate-pulse h-10 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    ) : stats.error ? (
                      <span className="text-sm font-medium text-red-500">Lỗi tải dữ liệu</span>
                    ) : (
                      <p className="text-4xl font-bold text-gray-800 dark:text-white animate-fade-in">{stats.closed}</p>
                    )}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col justify-between transition-colors">
                  <h3 className="text-gray-500 dark:text-gray-400 text-sm font-semibold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-red-500">warning</span> Công việc Trễ hạn</h3>
                  <div className="h-10 flex items-center">
                    {isLoading ? (
                      <div className="animate-pulse h-10 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    ) : stats.error ? (
                      <span className="text-sm font-medium text-red-500">Lỗi tải dữ liệu</span>
                    ) : (
                      <p className="text-4xl font-bold text-red-600 dark:text-red-400 animate-fade-in">{stats.overdue}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Lịch sử hoạt động (Newsfeed) */}
              {recentLogs.length > 0 && (
                <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 overflow-hidden mt-6">
                  <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-surface-container-low dark:bg-[#121212]">
                    <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                      <span className="material-symbols-outlined text-purple-500">history</span> Lịch sử hoạt động
                    </h3>
                  </div>
                  <div className="p-0 max-h-96 overflow-y-auto custom-scrollbar">
                    <ul className="divide-y divide-outline-variant dark:divide-gray-800">
                      {recentLogs.map((log, idx) => (
                        <li key={log.id || idx} className="p-4 hover:bg-gray-50 dark:hover:bg-[#252525] flex justify-between items-start transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm font-bold text-xs">
                              {log.org_unit ? log.org_unit.substring(0, 2).toUpperCase() : 'ALL'}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{log.content}</p>
                              <p className="text-xs text-gray-500 mt-1">{log.displayTime} - {log.date} {log.org_unit && `| ${log.org_unit}`}</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* AI Pings Widget */}
              {aiPings.length > 0 && (
                <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 mb-6 mt-6">
                  <h3 className="text-gray-800 dark:text-white font-bold mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-blue-500">lightbulb</span> Lời nhắn từ Cố vấn AI
                  </h3>
                  <div className="space-y-3">
                    {aiPings.map(ping => (
                      <div
                        key={ping.id}
                        onClick={() => onOpenTask && onOpenTask(ping.task)}
                        className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl flex items-start gap-3 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors border border-transparent hover:border-blue-200 dark:hover:border-blue-800"
                      >
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-200 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                          <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-medium">{ping.message}</p>
                          <div className="flex items-center justify-between mt-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">schedule</span> {ping.time}</p>
                            {!ping.task.needsSupport ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRequestSupport(ping.task.id);
                                }}
                                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold shadow-sm transition-colors flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[14px]">support_agent</span> Yêu cầu hỗ trợ
                              </button>
                            ) : (
                              <span className="text-xs font-bold text-success flex items-center gap-1">
                                <span className="material-symbols-outlined text-[14px]">check_circle</span> Đã báo cáo lên Ban GĐ
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 overflow-hidden mt-6">
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
                        <li
                          key={t.id}
                          onClick={() => onOpenTask && onOpenTask(t)}
                          className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#252525] flex justify-between items-center transition-colors"
                        >
                          <div>
                            <p className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                              {t.title}
                              {t.is_boss_assigned && (
                                <span className="relative group/star flex items-center justify-center" title="Nhiệm vụ chỉ đạo trực tiếp từ Sếp Tổng">
                                  <span className="material-symbols-outlined text-yellow-400 text-[16px] drop-shadow-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                </span>
                              )}
                              {t.needsSupport && (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md text-[10px] font-bold flex items-center gap-1 border border-red-200 dark:border-red-800/50">
                                  <span className="material-symbols-outlined text-[12px]">support_agent</span> Cần hỗ trợ
                                </span>
                              )}
                            </p>
                            <p className="text-sm text-gray-500">PIC: {(t.pic || 'Chưa phân công')} | Deadline: {t.deadline}</p>
                          </div>
                          <span className="px-3 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-lg text-xs font-bold">KHẨN CẤP</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* AI Advisor for Facility */}
              <div className="mt-6 h-[600px] flex flex-col">
                 <AIAdvisor 
                   user={user} 
                   isFacilityMode={!['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role)} 
                   facilityName={['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role) ? '' : (localStorage.getItem('facility_name') || user?.facilityName || 'bạn')} 
                 />
              </div>
            </>
          )}
        </div>
      );
    }

