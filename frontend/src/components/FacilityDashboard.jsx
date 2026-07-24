import React, { useState, useEffect, useRef } from 'react';
import AIAdvisor from './AIAdvisor';
import { fetchHistory } from '../services/dataService';

export default function FacilityDashboard({ user, tasks, onOpenTask, globalFacilityFilter }) {
      const [stats, setStats] = useState({ open: 0, closed: 0, overdue: 0, total: -1, error: false });
      const [urgentTasks, setUrgentTasks] = useState([]);
      const [overdueTasksList, setOverdueTasksList] = useState([]);
      const [aiPings, setAiPings] = useState([]);
      const [recentLogs, setRecentLogs] = useState([]);
      const [checkinAlerts, setCheckinAlerts] = useState({ support: [], incidents: [] });
      const [timeFilter, setTimeFilter] = useState('today');
      const [isLoading, setIsLoading] = useState(false);
      const [localFacFilter, setLocalFacFilter] = useState('ALL');
      const [facilitiesList] = useState(() => JSON.parse(localStorage.getItem('taskflow_facilities') || '[]'));
      const hasPingedAI = useRef(false); // 1. Tạo cờ khóa vĩnh viễn cho session hiện tại
      const handleRequestSupport = async (taskId) => {
        try {
          const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com'}/api/tasks/${taskId}/support`, {
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
               if (!isHighLevel && !isDeptHead) return true;
               if (isHighLevel && globalFacilityFilter === 'ALL') return true;
               if (isHighLevel && globalFacilityFilter !== 'ALL') {
                   const tTitle = (t.title || '').toLowerCase();
                   const tFacName = (t?.facilityId || t?.facility || '').toLowerCase();
                   const tDeptTag = (t?.department_tag || '').toLowerCase();
                   const tPicDept = (t?.pic_department_code || '').toLowerCase();
                   const filterLower = globalFacilityFilter.toLowerCase();
                   return tFacName.includes(filterLower) || tTitle.includes(filterLower) || tDeptTag === filterLower || tPicDept === filterLower;
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
               const matchRawId = String(t.facilityRawId) === String(user?.facility_id);
               return matchCode || matchName || matchRawId;
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

            // Helper: parse chuỗi ngày tháng, hỗ trợ cả ISO 8601 và DD/MM/YYYY HH:mm (định dạng backend VN)
            const parseDateSafe = (dateStr) => {
              if (!dateStr) return NaN;
              // Thử parse ISO trực tiếp trước
              const direct = new Date(dateStr);
              if (!isNaN(direct.getTime())) return direct.getTime();
              // Fallback: parse thủ công định dạng DD/MM/YYYY HH:mm hoặc DD/MM/YYYY
              const matchDMY = String(dateStr).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[\s,T]+(\d{1,2}):(\d{2}))?/);
              if (matchDMY) {
                const [, d, m, y, h = '0', min = '0'] = matchDMY;
                const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
                if (!isNaN(parsed.getTime())) return parsed.getTime();
              }
              return NaN;
            };

            const getCompletedTime = (t) => {
              const realTime = parseDateSafe(t?.completedAtReal);
              if (!isNaN(realTime)) return realTime;
              const compTime = parseDateSafe(t?.completedAt);
              if (!isNaN(compTime)) return compTime;
              // Nếu task đã ở trạng thái done/review nhưng chưa có completedAt,
              // dùng thời điểm hiện tại để bộ lọc "Hôm nay" bắt được đúng.
              if (t?.status === 'done' || t?.status === 'review') return now.getTime();
              const deadlineTime = parseDateSafe(t?.deadline);
              return !isNaN(deadlineTime) ? deadlineTime : now.getTime();
            };

            const getDeadlineTime = (t) => {
              if (!t?.deadline || typeof t.deadline !== 'string') return 0;
              // Nếu deadline có chứa giờ phút (chứa T hoặc khoảng trắng)
              if (t.deadline.includes('T') || t.deadline.includes(' ')) {
                const parsed = new Date(t.deadline).getTime();
                if (!isNaN(parsed)) return parsed;
              }
              // Nếu chỉ có ngày tháng năm, gán mặc định hạn chót là cuối ngày đó 23:59:59
              const [y, m, d] = t.deadline.split('-');
              if (!y || !m || !d) return 0;
              const cleanD = parseInt(d, 10);
              return new Date(y, m - 1, cleanD, 23, 59, 59).getTime();
            };

            // [FIX] Công việc Mở = tất cả task chưa xong, BẤT KỂ ngày tạo.
            // Không lọc theo thời gian vì task tạo hôm qua vẫn cần hiển thị nếu chưa xử lý.
            const openCount = myTasks.filter(t => {
              if (t?.status === 'done' || t?.status === 'review' || t?.status === 'revoked') return false;
              return true;
            }).length;

            // [FIX] Backend đã lọc task 'done' trong tháng hiện tại (updated_at >= date_trunc('month')).
            // completedAt từ API thực chất là updated_at (không phải ngày hoàn thành thực sự).
            // Không filter thêm theo thời gian ở frontend để tránh loại nhầm task đã hoàn thành.
            const closedCount = myTasks.filter(t =>
              t?.status === 'done' || t?.status === 'review'
            ).length;

            // [FIX] Công việc Trễ hạn = task đang mở có deadline đã qua, KHÔNG lọc theo timeframe
            // để đồng bộ với danh sách "Công việc quá hạn" phía dưới.
            const nowTime_stat = now.getTime();
            const overdueCount = myTasks.filter(t => {
              const dTime = getDeadlineTime(t);
              if (dTime === 0) return false;
              if (t?.status === 'done' || t?.status === 'revoked') return false;
              return dTime < nowTime_stat;
            }).length;

            setStats({ open: openCount ?? 0, closed: closedCount ?? 0, overdue: overdueCount ?? 0, total: myTasks.length });

            const nowTime = now.getTime();
            const msIn48h = 48 * 60 * 60 * 1000;

            // Chỉ tính các task đang còn mở (chưa hoàn thành / chưa nghiệm thu / chưa thu hồi)
            const activeTasks = myTasks.filter(t => t?.status !== 'done' && t?.status !== 'review' && t?.status !== 'revoked');

            // 1. Công việc QUÁ HẠN: deadline đã qua hiện tại
            const overdueList = activeTasks.filter(t => {
              const dTime = getDeadlineTime(t);
              return dTime > 0 && dTime < nowTime;
            });
            setOverdueTasksList(overdueList || []);

            // 2. Công việc KHẨN CẤP: deadline còn lại <= 48h (hoặc được ghim/đánh dấu urgent mà chưa quá hạn)
            const urgentList = activeTasks.filter(t => {
              const dTime = getDeadlineTime(t);
              const isExpiringSoon = dTime > nowTime && (dTime - nowTime) <= msIn48h;
              const isPinnedNotOverdue = (t?.urgent || t?.pinned) && (dTime === 0 || dTime >= nowTime);
              return isExpiringSoon || isPinnedNotOverdue;
            });
            setUrgentTasks(urgentList || []);

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
              try {
                const history = await fetchHistory({ entry_type: 'Operation_Log' });
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
         };
         loadRecentLogs();
      }, [user?.id, user?.role, user?.department_id, user?.username, user?.facility_id, globalFacilityFilter]);

      // --- FETCH DỮ LIỆU ĐIỂM DANH: HỖ TRỢ NHÂN SỰ & SỰ CỐ THIẾT BỊ ---
      useEffect(() => {
        const loadCheckinAlerts = async () => {
          // Chỉ hiển thị cho SUPER_ADMIN, VICE_PRESIDENT, ADMIN
          if (!['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user?.role)) {
            setCheckinAlerts({ support: [], incidents: [] });
            return;
          }
          try {
            const now = new Date();
            const workDay = new Date(now);
            if (now.getHours() < 6) workDay.setDate(workDay.getDate() - 1);
            const todayStr = `${workDay.getDate().toString().padStart(2, '0')}/${(workDay.getMonth() + 1).toString().padStart(2, '0')}/${workDay.getFullYear()}`;

            const logs = await fetchHistory({ entry_type: 'Attendance' });
            const todayLogs = logs.filter(l => l.date === todayStr);

            // Lọc theo cơ sở nếu có filter
            let filteredLogs = todayLogs;
            if (globalFacilityFilter && globalFacilityFilter !== 'ALL') {
              filteredLogs = todayLogs.filter(l => {
                const orgLower = String(l.org_unit || '').toLowerCase();
                const filterLower = globalFacilityFilter.toLowerCase();
                return orgLower === filterLower || orgLower.includes(filterLower);
              });
            }

            const support = [];
            const incidents = [];
            const hrLabels = { hr_letan: 'Lễ tân', hr_baove: 'Bảo vệ', hr_clocker: 'Clocker', hr_ktv: 'KTV' };
            const eqLabels = { eq_camera: 'Camera', eq_maytinh: 'Máy tính', eq_den: 'Đèn bảng hiệu', eq_maylanh: 'Máy lạnh' };

            filteredLogs.forEach(log => {
              let c = log.content;
              if (typeof c === 'string') { try { c = JSON.parse(c); } catch { return; } }
              if (!c) return;
              const shift = c.shift || '';
              const facilityName = facilitiesList.find(f => String(f.id) === String(log.org_unit))?.name || log.org_unit || '';

              // Hỗ trợ nhân sự
              Object.entries(hrLabels).forEach(([key, label]) => {
                if (c[key]?.status === 'thieu') {
                  support.push({
                    id: `${log.id}-${key}`,
                    facility: facilityName,
                    facilityCode: log.org_unit,
                    shift,
                    position: label,
                    note: c[key]?.note || '',
                    time: log.display_time || log.displayTime || ''
                  });
                }
              });

              // Sự cố thiết bị
              Object.entries(eqLabels).forEach(([key, label]) => {
                if (c[key] === 'su_co') {
                  incidents.push({
                    id: `${log.id}-${key}`,
                    facility: facilityName,
                    facilityCode: log.org_unit,
                    shift,
                    equipment: label,
                    note: c[key + '_note'] || '',
                    time: log.display_time || log.displayTime || ''
                  });
                }
              });

              // Ghi chú thiết bị khác
              if (c.eq_other && String(c.eq_other).trim()) {
                incidents.push({
                  id: `${log.id}-eq_other`,
                  facility: facilityName,
                  facilityCode: log.org_unit,
                  shift,
                  equipment: 'Khác',
                  note: String(c.eq_other).trim(),
                  time: log.display_time || log.displayTime || ''
                });
              }
            });

            setCheckinAlerts({ support, incidents });
          } catch (e) {
            console.error('Error loading checkin alerts:', e);
          }
        };
        loadCheckinAlerts();
      }, [user?.id, user?.role, globalFacilityFilter]);

      // --- BƯỚC 1 & 2: ENGINE AI PING GỌI BATCH API VỀ NODE.JS ---
      useEffect(() => {
        // 2. Kiểm tra điều kiện: Nếu chưa có tasks, user, hoặc ĐÃ PING RỒI thì dừng ngay!
        if (!user?.id || !tasks || tasks.length === 0 || hasPingedAI.current) return;

        const runAIPing = async () => {
          // 3. Khóa chết cờ NGAY LẬP TỨC trước khi gọi API
          hasPingedAI.current = true; 
          
          try {

            const topUrgent = tasks.filter(t => t?.status !== 'done' && t?.status !== 'revoked' && (t?.urgent || t?.pinned)).slice(0, 3);
            if (topUrgent.length === 0) return;
            
            const taskIds = topUrgent.map(t => t.id);
            const token = localStorage.getItem('token') || localStorage.getItem('taskflow_token');
            
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com'}/api/ai/ping-batch`, {
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
                    : `Tổng quan - ${user?.facility_name || facilitiesList.find(f => String(f.id) === String(user?.facility_id))?.name || user?.facility_code || user?.facility_id || 'Tất cả cơ sở'}`}
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

              {/* === SECTION: CẦN HỖ TRỢ NHÂN SỰ === */}
              {checkinAlerts.support.length > 0 && (
                <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-orange-200 dark:border-orange-800/40 overflow-hidden mt-6">
                  <div className="p-4 border-b border-orange-200 dark:border-orange-800/40 bg-orange-50 dark:bg-orange-900/20">
                    <h3 className="font-bold text-orange-700 dark:text-orange-300 flex items-center gap-2">
                      <span className="material-symbols-outlined text-orange-500">support_agent</span>
                      Cần Hỗ Trợ Nhân Sự
                      <span className="ml-auto px-2.5 py-0.5 bg-orange-500 text-white text-xs font-bold rounded-full shadow-sm">{checkinAlerts.support.length}</span>
                    </h3>
                  </div>
                  <div className="p-0 max-h-72 overflow-y-auto custom-scrollbar">
                    <ul className="divide-y divide-orange-100 dark:divide-orange-900/30">
                      {checkinAlerts.support.map(item => (
                        <li key={item.id} className="p-4 hover:bg-orange-50/50 dark:hover:bg-orange-900/10 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm font-bold text-xs">
                              {item.facilityCode ? String(item.facilityCode).substring(0, 2).toUpperCase() : '??'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">{item.facility}</span>
                                <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded text-[10px] font-medium">{item.shift}</span>
                                <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded text-[10px] font-bold">{item.position}</span>
                              </div>
                              {item.note && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{item.note}</p>}
                              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">schedule</span> {item.time}</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* === SECTION: SỰ CỐ THIẾT BỊ === */}
              {checkinAlerts.incidents.length > 0 && (
                <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-red-200 dark:border-red-800/40 overflow-hidden mt-6">
                  <div className="p-4 border-b border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20">
                    <h3 className="font-bold text-red-700 dark:text-red-300 flex items-center gap-2">
                      <span className="material-symbols-outlined text-red-500">report_problem</span>
                      Sự Cố Thiết Bị & CSVC
                      <span className="ml-auto px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full shadow-sm">{checkinAlerts.incidents.length}</span>
                    </h3>
                  </div>
                  <div className="p-0 max-h-72 overflow-y-auto custom-scrollbar">
                    <ul className="divide-y divide-red-100 dark:divide-red-900/30">
                      {checkinAlerts.incidents.map(item => (
                        <li key={item.id} className="p-4 hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm font-bold text-xs">
                              {item.facilityCode ? String(item.facilityCode).substring(0, 2).toUpperCase() : '??'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">{item.facility}</span>
                                <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded text-[10px] font-medium">{item.shift}</span>
                                <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-[10px] font-bold">{item.equipment}</span>
                              </div>
                              {item.note && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{item.note}</p>}
                              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">schedule</span> {item.time}</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* === SECTION: XIN GIA HẠN CHỜ DUYỆT === */}
              {['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user?.role) && (() => {
                const extensionTasks = (Array.isArray(tasks) ? tasks : []).filter(t => t?.extensionRequested === true && t?.status !== 'done' && t?.status !== 'revoked');
                if (extensionTasks.length === 0) return null;
                return (
                  <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-amber-200 dark:border-amber-800/40 overflow-hidden mt-6">
                    <div className="p-4 border-b border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20">
                      <h3 className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                        <span className="material-symbols-outlined text-amber-500">event_upcoming</span>
                        Công việc xin gia hạn chờ duyệt
                        <span className="ml-auto px-2.5 py-0.5 bg-amber-500 text-white text-xs font-bold rounded-full shadow-sm">{extensionTasks.length}</span>
                      </h3>
                    </div>
                    <div className="p-0 max-h-72 overflow-y-auto custom-scrollbar">
                      <ul className="divide-y divide-amber-100 dark:divide-amber-900/30">
                        {extensionTasks.map(task => (
                          <li
                            key={task.id}
                            onClick={() => onOpenTask && onOpenTask(task)}
                            className="p-4 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors cursor-pointer"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                                <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm text-gray-800 dark:text-gray-200 truncate">{task.title}</p>
                                <div className="flex items-center gap-2 flex-wrap mt-1">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">PIC: <span className="font-medium text-gray-700 dark:text-gray-300">{task.pic || 'Chưa giao'}</span></span>
                                  <span className="text-gray-300 dark:text-gray-600">•</span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">Cơ sở: <span className="font-medium text-gray-700 dark:text-gray-300">{task.facility || '—'}</span></span>
                                  <span className="text-gray-300 dark:text-gray-600">•</span>
                                  <span className="text-xs text-red-500 dark:text-red-400 font-medium">Deadline: {task.deadline ? task.deadline.replace('T', ' lúc ') : '—'}</span>
                                </div>
                                {task.extensionReason && (
                                  <div className="mt-2 flex items-start gap-1.5">
                                    <span className="material-symbols-outlined text-amber-400 text-[14px] shrink-0 mt-0.5">chat_bubble</span>
                                    <p className="text-xs text-gray-600 dark:text-gray-400 italic">"{task.extensionReason}"</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })()}

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
                      {recentLogs.map((log, idx) => {
                        const facName = facilitiesList.find(f => String(f.id) === String(log.org_unit))?.name || log.org_unit || '';
                        const facShort = facName.replace(/^DUBAI\s*/i, '').trim() || facName;
                        return (
                        <li key={log.id || idx} className="p-4 hover:bg-gray-50 dark:hover:bg-[#252525] flex justify-between items-start transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm font-bold text-xs">
                              {facShort || 'ALL'}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{log.content}</p>
                              <p className="text-xs text-gray-500 mt-1">{log.displayTime} - {log.date} {facName && `| ${facName}`}</p>
                            </div>
                          </div>
                        </li>
                        );
                      })}
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

              {/* === SECTION: CÔNG VIỆC QUÁ HẠN === */}
              {overdueTasksList.length > 0 && (
                <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border-2 border-red-500 dark:border-red-600 overflow-hidden mt-6">
                  <div className="p-4 border-b border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/50">
                    <h3 className="font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                      <span className="material-symbols-outlined text-red-600 animate-pulse">error</span>
                      Công việc quá hạn
                      <span className="ml-auto px-2.5 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full shadow-sm">{overdueTasksList.length}</span>
                    </h3>
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-semibold">⚠️ Cảnh báo: Các công việc dưới đây đã vượt quá thời hạn cho phép!</p>
                  </div>
                  <div className="p-0 max-h-96 overflow-y-auto custom-scrollbar">
                    <ul className="divide-y divide-red-100 dark:divide-red-900/30">
                      {overdueTasksList.map(t => (
                        <li
                          key={t.id}
                          onClick={() => onOpenTask && onOpenTask(t)}
                          className="p-4 cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/10 flex justify-between items-center transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
                              <span className="material-symbols-outlined text-red-500 text-[18px]">schedule</span>
                              {t.title}
                              {t.priority_stars > 0 && (
                                <span className="relative group/star flex items-center justify-center">
                                  {Array.from({ length: t.priority_stars }).map((_, i) => (
                                    <span key={i} className="material-symbols-outlined text-yellow-400 text-[16px] drop-shadow-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                  ))}
                                </span>
                              )}
                              {t.needsSupport && (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md text-[10px] font-bold flex items-center gap-1 border border-red-200 dark:border-red-800/50">
                                  <span className="material-symbols-outlined text-[12px]">support_agent</span> Cần hỗ trợ
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-medium">PIC: {(t.pic || 'Chưa phân công')} | Deadline: {t.deadline}</p>
                          </div>
                          <span className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-bold ml-3 whitespace-nowrap shadow-sm">QUÁ HẠN</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* === SECTION: CÔNG VIỆC CẦN CHÚ Ý KHẨN CẤP (gần hết hạn trong 48h) === */}
              <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 overflow-hidden mt-6">
                <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-surface-container-low dark:bg-[#121212]">
                  <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-orange-500">local_fire_department</span> Công việc cần chú ý khẩn cấp
                    <span className="ml-2 text-xs text-orange-500 font-normal">(gần hết hạn trong 48 giờ)</span>
                    {urgentTasks.length > 0 && <span className="ml-auto px-2.5 py-0.5 bg-orange-500 text-white text-xs font-bold rounded-full shadow-sm">{urgentTasks.length}</span>}
                  </h3>
                </div>
                <div className="p-0 max-h-96 overflow-y-auto custom-scrollbar">
                  {urgentTasks.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Tuyệt vời! Không có công việc nào sắp hết hạn trong 48 giờ tới.</div>
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
                              {t.priority_stars > 0 && (
                                <span className="relative group/star flex items-center justify-center">
                                  {Array.from({ length: t.priority_stars }).map((_, i) => (
                                    <span key={i} className="material-symbols-outlined text-yellow-400 text-[16px] drop-shadow-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                  ))}
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

