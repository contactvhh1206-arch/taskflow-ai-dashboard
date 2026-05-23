import React, { useState, useEffect, useRef } from 'react';

export default function FacilityDashboard({ user, tasks, onNavigate, onOpenTask, globalFacilityFilter }) {
      const [stats, setStats] = useState({ open: 0, closed: 0, overdue: 0, total: -1, error: false });
      const [urgentTasks, setUrgentTasks] = useState([]);
      const [aiPings, setAiPings] = useState([]);
      const [recentLogs, setRecentLogs] = useState([]);
      const [timeFilter, setTimeFilter] = useState('today');
      const [isLoading, setIsLoading] = useState(false);

      useEffect(() => {
        setIsLoading(true);
        const timer = setTimeout(() => {
          try {
            // Safe array fallback and Row-level security
            const safeTasks = Array.isArray(tasks) ? tasks : [];
            const isHighLevel = user?.role !== 'DEPARTMENT_HEAD' && (user?.facility_id === 'ALL' || ['SUPER_ADMIN', 'VICE_PRESIDENT', 'GENERAL_MANAGER', 'ADMIN'].includes(user?.role));
            const facCode = (user?.facility_code || '').toLowerCase();
            const isDeptHead = ['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role);
            const deptId = user?.department_id || (user?.username === 'marketing' ? 'MARKETING' : (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : ''));
            
            const myTasks = safeTasks.filter(t => {
               if (isHighLevel) return true;
               if (isDeptHead) {
                  const tTitle = (t.title || '').toLowerCase();
                  return t.department_tag === deptId || t.pic === user?.name || t.picId === user?.username || (deptId === 'MARKETING' && (tTitle.includes('marketing') || tTitle.includes('ads') || tTitle.includes('quảng cáo') || tTitle.includes('kịch bản') || tTitle.includes('video'))) || (deptId === 'FINANCE' && (tTitle.includes('doanh thu') || tTitle.includes('kế toán') || tTitle.includes('tài chính')));
               }
               const tFacName = (t?.facilityId || '').toLowerCase();
               const tFacCode = (t?.facility || '').toLowerCase();
               const uName = (user?.username || '').toLowerCase();
               return tFacName === facCode || tFacCode === facCode || tFacName === uName || tFacCode === uName;
            });

            const now = new Date();
            let startOfFrame = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            let endOfFrame = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

            if (timeFilter === 'week') {
              const day = now.getDay() || 7;
              startOfFrame = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
              endOfFrame = new Date(startOfFrame.getFullYear(), startOfFrame.getMonth(), startOfFrame.getDate() + 6, 23, 59, 59);
            } else if (timeFilter === 'month') {
              startOfFrame = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
              endOfFrame = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
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

            // Generate Empathetic AI Pings based on urgent tasks for this user
            const sysPrompts = JSON.parse(localStorage.getItem('taskflow_system_prompts') || '{}');
            const pingTemplate = sysPrompts.empatheticPing || 'Tôi thấy công việc "[TASK_TITLE]" đang tới hạn. Bạn có cần hỗ trợ điều phối thêm nhân sự không? Đừng quá áp lực nhé!';

            const pings = (urgent || []).slice(0, 3).map((t, idx) => {
              const message = pingTemplate.replace('[TASK_TITLE]', t.title);
              console.log('[OpenRouter API Call] System Prompt Ping:', pingTemplate);
              return {
                id: `ping-${t.id}-${idx}`,
                task: t,
                message: message,
                time: `${(idx + 1) * 15} phút trước`
              };
            });
            setAiPings(pings);

            if (window.DataService) {
              const history = window.DataService.fetchHistory({ entry_type: 'Operation_Log' });
              let filteredLogs = history;
              if (['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role)) {
                 const deptId = user?.department_id || (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : (user?.username === 'marketing' ? 'MARKETING' : 'ALL'));
                 filteredLogs = history.filter(h => h.org_unit === deptId);
              } else {
                 const facFilter = globalFacilityFilter === 'ALL' ? '' : globalFacilityFilter;
                 filteredLogs = facFilter ? history.filter(h => h.org_unit === facFilter || h.org_unit === user?.facility_id) : history;
              }
              setRecentLogs(filteredLogs.slice(0, 10));
            }

          } catch (err) {
            console.error("Dashboard calculation error:", err);
            setStats({ error: true });
          } finally {
            setIsLoading(false);
          }
        }, 600); // Simulate API latency

        return () => clearTimeout(timer);
      }, [tasks, user, timeFilter, user?.facility_id, user?.facility_name, globalFacilityFilter]);
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
                  ? `Bảng tin công việc - ${user?.department || (user?.role === 'FINANCE_DEPT' ? 'Phòng Kế Toán' : 'Phòng ban')}` 
                  : ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user?.role)
                  ? `Tổng quan - ${globalFacilityFilter === 'ALL' ? 'Tất cả cơ sở & Phòng ban' : (globalFacilityFilter || 'Tất cả cơ sở & Phòng ban')}`
                  : `Tổng quan - ${user?.facility_name || 'Tất cả cơ sở'}`}
              </h2>
              <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">
                {['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role) ? 'Dữ liệu Real-time nội bộ phòng ban.' : 'Dữ liệu Real-time nội bộ cơ sở.'}
              </p>
            </div>

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
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">schedule</span> {ping.time}</p>
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
                            </p>
                            <p className="text-sm text-gray-500">PIC: {getDisplayName(t.pic)} | Deadline: {t.deadline}</p>
                          </div>
                          <span className="px-3 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-lg text-xs font-bold">KHẨN CẤP</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      );
    }
