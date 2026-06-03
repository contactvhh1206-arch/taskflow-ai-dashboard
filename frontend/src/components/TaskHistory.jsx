import React, { useState, useEffect, useRef } from 'react';
import axiosClient from '../api/axiosClient.js';
import TaskHistoryDetailModal from './TaskHistoryDetailModal.jsx';

const TaskHistory = () => {
  // 1. STATE MANAGEMENT CHUẨN MỰC
  const [selectedTask, setSelectedTask] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0); // Added for UI display
  const [filters, setFilters] = useState({ date_from: '', date_to: '', pic_id: '' });
  
  // Debounce State: Cứu tinh của DB, tránh Spam truy vấn
  const [debouncedPicId, setDebouncedPicId] = useState('');

  // 2. LÕI HỦY REQUEST VÀ KHÓA LUỒNG (Ngăn Race Condition)
  const abortControllerRef = useRef(null);
  const isFetchingRef = useRef(false);

  // 3. LOGIC DEBOUNCE 500ms CHO INPUT TEXT
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedPicId(filters.pic_id);
    }, 500);
    return () => clearTimeout(handler);
  }, [filters.pic_id]);

  // 4. KÍCH HOẠT API KHI STATE ĐỔI
  useEffect(() => {
    fetchHistoryTasks();
    
    // Cleanup function: Đảm bảo khi Component Unmount, mọi request bay giữa chừng sẽ bị bắn hạ
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [currentPage, debouncedPicId, filters.date_from, filters.date_to]);

  const fetchHistoryTasks = async () => {
    // [VÁ EDGE CASE 1]: CHẶN LỖ HỔNG THỜI GIAN NGHỊCH LÝ
    if (filters.date_from && filters.date_to) {
      if (new Date(filters.date_from) > new Date(filters.date_to)) {
        alert("Lỗi logic: 'Từ ngày' không thể lớn hơn 'Đến ngày'. Hệ thống đã chặn truy vấn này!");
        setLoading(false);
        return; // Khóa van, không cho API chạy xuống dưới
      }
    }

    if (isFetchingRef.current) return;
    
    // Rút súng bắn hạ request cũ nếu nó chưa chạy xong
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    isFetchingRef.current = true;
    setIsHistoryLoading(true);

    try {
      const params = {
        page: currentPage,
        limit: 50,
        ...(debouncedPicId && { pic_id: debouncedPicId }),
        ...(filters.date_from && { date_from: filters.date_from }),
        ...(filters.date_to && { date_to: filters.date_to })
      };

      const res = await axiosClient.get('/api/tasks/history', {
        params,
        signal: abortControllerRef.current.signal // Gắn cờ Signal để Abort
      });

      if (res.data.success) {
        setTasks(res.data.data);
        if (res.data.pagination) {
          setTotalPages(res.data.pagination.total_pages);
          setTotalRecords(res.data.pagination.total_records);
        }
      }
    } catch (error) {
      // Bắt lỗi do Chủ động Hủy (Canceled) -> Cấm văng console.error làm rác log
      if (error.name === 'CanceledError' || error.message === 'canceled') {
        console.log('API call aborted by user action');
      } else {
        console.error('Lỗi tải lịch sử công việc:', error);
      }
    } finally {
      // Chỉ tắt Loading Overlay nếu đây là request cuối cùng (không bị hủy ngang)
      if (abortControllerRef.current?.signal?.aborted === false) {
        isFetchingRef.current = false;
        setIsHistoryLoading(false);
      }
    }
  };

  // 5. HANDLERS ĐIỀU HƯỚNG & LỌC
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    // Cực kỳ quan trọng: Lọc lại từ đầu thì phải về trang 1
    setCurrentPage(1); 
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Tiêu đề */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-on-surface dark:text-white">Lịch sử công việc hoàn thành</h2>
          <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">Hệ thống cất kho tự động các công việc đã xử lý.</p>
        </div>
      </div>

      {/* FILTER UI */}
      <div className="bg-white dark:bg-[#1e1e1e] p-4 rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-500 mb-1">Từ ngày</label>
          <input 
            type="date" 
            name="date_from"
            value={filters.date_from}
            onChange={handleFilterChange}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-500 mb-1">Đến ngày</label>
          <input 
            type="date" 
            name="date_to"
            value={filters.date_to}
            onChange={handleFilterChange}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-gray-500 mb-1">Người phụ trách (Debounce 500ms)</label>
          <div className="relative">
             <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-400 text-[18px]">search</span>
             <input 
               type="text" 
               name="pic_id"
               placeholder="Nhập tên, mã số..."
               value={filters.pic_id}
               onChange={handleFilterChange}
               className="pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm w-full bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-primary"
             />
          </div>
        </div>
      </div>

      {/* TABLE UI */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 overflow-hidden flex-1 shadow-sm flex flex-col relative min-h-[400px]">
        {isHistoryLoading && (
          <div className="absolute inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-sm z-10 flex items-center justify-center transition-all duration-200">
            <span className="material-symbols-outlined animate-spin text-4xl text-primary">autorenew</span>
          </div>
        )}
        
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400 border-b border-outline-variant dark:border-gray-700 sticky top-0 z-0">
              <tr>
                <th className="px-6 py-4 font-semibold w-1/2">Công việc</th>
                <th className="px-6 py-4 font-semibold w-1/4">Người phụ trách</th>
                <th className="px-6 py-4 font-semibold text-center whitespace-nowrap">Bình luận</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">Ngày hoàn thành</th>
              </tr>
            </thead>
            <tbody>
              {!isHistoryLoading && tasks.length === 0 ? (
                <tr><td colSpan="4" className="text-center py-16 text-gray-400">Không tìm thấy dữ liệu khớp với bộ lọc</td></tr>
              ) : tasks.map(task => (
                <tr 
                  key={task.id} 
                  onClick={() => setSelectedTask(task)}
                  className="border-b border-outline-variant dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <div className="font-medium text-on-surface dark:text-white truncate max-w-[300px] md:max-w-md">{task.title}</div>
                    {task.desc && <div className="text-xs text-gray-500 mt-1 line-clamp-1">{task.desc}</div>}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold uppercase shrink-0">
                        {(task.pic || '?').charAt(0)}
                      </div>
                      <span className="dark:text-gray-300 truncate max-w-[150px]">{task.pic || task.picId || 'Unassigned'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-300 font-medium">
                      <span className="material-symbols-outlined text-[14px]">chat_bubble</span>
                      {task.comment_count || 0}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">
                    {new Date(task.completedAt).toLocaleString('vi-VN', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* PAGINATION UI */}
        <div className="px-6 py-4 border-t border-outline-variant dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Tổng số: <strong className="text-gray-900 dark:text-white">{totalRecords}</strong> bản ghi
          </span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Trang <strong className="dark:text-white">{currentPage}</strong> / {totalPages || 1}
            </span>
            <div className="flex gap-2">
              <button 
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1 || isHistoryLoading}
                className="p-1.5 rounded bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
              </button>
              <button 
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages || isHistoryLoading}
                className="p-1.5 rounded bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KHI CLICK VÀO TASK NÀO THÌ HIỂN THỊ MODAL */}
      {selectedTask && (
        <TaskHistoryDetailModal 
          task={selectedTask} 
          onClose={() => setSelectedTask(null)} 
          onRestoreSuccess={(restoredTaskId) => {
             // [VÁ EDGE CASE 2]: BẪY PHÂN TRANG (Tránh hiển thị bảng trắng trơn)
             setTasks(prevTasks => {
               // Nếu màn hình hiện tại đang chót vót ở Trang 2 trở lên, 
               // mà chỉ còn đúng 1 Record cuối cùng -> Xóa xong sẽ thành trang trắng.
               // => Ép luồng lùi về trang trước đó ngay lập tức!
               if (prevTasks.length === 1 && currentPage > 1) {
                  setCurrentPage(prev => prev - 1);
               }
               // Chém bay task bị khôi phục khỏi giao diện
               return prevTasks.filter(t => t.id !== restoredTaskId);
             });
             // Cập nhật lại số lượng tổng đếm
             setTotalRecords(prev => Math.max(0, prev - 1));
          }}
        />
      )}
    </div>
  );
};

export default TaskHistory;
