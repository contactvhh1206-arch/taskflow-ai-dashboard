import React, { useState, useEffect, useRef } from 'react';
import axiosClient from '../api/axiosClient.js';

export default function TaskHistoryDetailModal({ task, onClose, onRestoreSuccess }) {
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  
  // VŨ KHÍ CHỐNG SPAM CLICK & MEMORY LEAK
  const abortControllerRef = useRef(null);

  // --- STATE KHÔI PHỤC (BƯỚC 4) ---
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [newDeadline, setNewDeadline] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  // Auto-fetch lịch sử bình luận khi mở Modal
  useEffect(() => {
    if (task && task.id) {
      fetchComments();
    }
    
    // Cleanup Function: Cắt cầu giao ngay khi Modal bị Unmount hoặc Task ID thay đổi
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [task]);

  const fetchComments = async () => {
    // Nếu có request cũ đang bay -> Bắn hạ ngay lập tức
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      setLoadingComments(true);
      const res = await axiosClient.get(`/api/tasks/${task.id}/comments`, {
        signal: abortControllerRef.current.signal // Gắn cờ Signal để Abort
      });
      
      if (res.data && res.data.success) {
        setComments(res.data.data);
      }
    } catch (error) {
      // Ép khuôn báo lỗi: Không xả rác ra Console nếu lỗi do chủ động hủy (Canceled)
      if (error.name === 'CanceledError' || error.message === 'canceled') {
        console.log(`[TaskHistory] Đã hủy fetch comments cho task ${task.id} do đổi Modal.`);
      } else {
        console.error('Lỗi tải lịch sử bình luận:', error);
      }
    } finally {
      // Chỉ tắt Loading nếu request này là request sống sót cuối cùng
      if (abortControllerRef.current?.signal?.aborted === false) {
        setLoadingComments(false);
      }
    }
  };

  // CƠ CHẾ BẢO MẬT TÀI LIỆU (Blob Stream Download)
  const handleDownloadAttachment = async (fileUrl, fileName) => {
    try {
      const response = await axiosClient.get(fileUrl, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName || 'tai-lieu-dinh-kem');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Lỗi tải file đính kèm:', error);
      alert('Không thể tải tệp tin. Có thể file đã bị vô hiệu hóa.');
    }
  };

  const executeRestore = async () => {
    if (!newDeadline) return; // Chặn cứng nếu bypass qua F12
    
    try {
      setIsRestoring(true);
      const res = await axiosClient.patch(`/api/tasks/${task.id}/restore`, { deadline: newDeadline });
      
      if (res.data && res.data.success) {
         // Kích hoạt Optimistic UI: Gọi hàm cha để cắt task này khỏi list
         if (onRestoreSuccess) {
            onRestoreSuccess(task.id);
         }
         onClose(); // Giết Modal ngay lập tức
      } else {
         alert(res.data?.error || 'Khôi phục thất bại.');
      }
    } catch (error) {
      console.error('Lỗi khi khôi phục:', error);
      alert('Mạng chập chờn. Không thể kết nối tới Server.');
    } finally {
      setIsRestoring(false);
    }
  };

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden border border-outline-variant dark:border-gray-800">
        
        {/* CỘT TRÁI: THÔNG TIN TASK (READ-ONLY) */}
        <div className="w-full md:w-3/5 p-6 md:p-8 overflow-y-auto border-b md:border-b-0 md:border-r border-outline-variant dark:border-gray-800 relative">
          
          {/* --- OVERLAY: PROMPT BẮT BUỘC CHỌN DEADLINE MỚI --- */}
          {showRestorePrompt && (
            <div className="absolute inset-0 z-[60] bg-white/95 dark:bg-[#1e1e1e]/95 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in zoom-in duration-200">
               <div className="bg-white dark:bg-[#252525] p-6 rounded-2xl border border-outline-variant dark:border-gray-700 shadow-2xl w-full max-w-sm">
                  <div className="flex items-center gap-3 text-orange-600 dark:text-orange-400 mb-2">
                     <span className="material-symbols-outlined text-3xl">warning</span>
                     <h3 className="text-lg font-bold text-gray-900 dark:text-white">Xác nhận Khôi Phục</h3>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 leading-relaxed">
                     Bạn đang kéo công việc này trở lại luồng thực thi. <strong className="text-gray-900 dark:text-gray-200">Bắt buộc phải gia hạn Deadline mới</strong> để hệ thống tái theo dõi.
                  </p>
                  
                  <div className="mb-6">
                     <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Chọn Deadline Mới <span className="text-red-500">*</span></label>
                     <input 
                       type="date" 
                       value={newDeadline}
                       onChange={(e) => setNewDeadline(e.target.value)}
                       className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none transition"
                     />
                  </div>

                  <div className="flex justify-end gap-3">
                     <button 
                       onClick={() => setShowRestorePrompt(false)}
                       disabled={isRestoring}
                       className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                     >
                       Hủy
                     </button>
                     <button 
                       onClick={executeRestore}
                       disabled={!newDeadline || isRestoring}
                       className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition"
                     >
                       {isRestoring && <span className="material-symbols-outlined animate-spin text-[16px]">autorenew</span>}
                       Khôi phục ngay
                     </button>
                  </div>
               </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">history</span>
              Đối soát Công việc
            </h2>
            <div className="flex items-center gap-3">
               {/* Nút Khôi Phục hiển thị ở Header */}
               <button 
                 onClick={() => setShowRestorePrompt(true)}
                 className="flex items-center gap-2 bg-orange-100 hover:bg-orange-200 text-orange-700 dark:bg-orange-900/40 dark:hover:bg-orange-900/60 dark:text-orange-300 px-4 py-2 rounded-lg text-sm font-semibold transition border border-orange-200 dark:border-orange-800"
               >
                 <span className="material-symbols-outlined text-[18px]">restore</span>
                 Khôi phục Task
               </button>
               <button onClick={onClose} className="md:hidden text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                 <span className="material-symbols-outlined">close</span>
               </button>
            </div>
          </div>

          <div className="space-y-6">
            {/* ALERT BẢO VỆ DỮ LIỆU */}
            <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 p-3 rounded-lg flex items-start gap-3 border border-yellow-200 dark:border-yellow-800/50">
              <span className="material-symbols-outlined text-yellow-600 dark:text-yellow-400 mt-0.5">lock</span>
              <div className="text-sm">
                <strong className="block mb-0.5">Chế độ Chỉ Đọc (Archived Mode)</strong>
                Bản ghi này mang tính chất đối soát lịch sử. Mọi thao tác chỉnh sửa hoặc thêm bình luận mới đều đã bị khóa vĩnh viễn.
              </div>
            </div>

            {/* Chi tiết nội dung */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tiêu đề công việc</label>
              <div className="text-gray-900 dark:text-white font-medium p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700/50">
                {task.title}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Mô tả chi tiết</label>
              <div className="text-gray-700 dark:text-gray-300 text-sm p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700/50 min-h-[100px] whitespace-pre-wrap">
                {task.desc || <span className="italic text-gray-400">Trống</span>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Người phụ trách</label>
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold uppercase shrink-0">
                    {(task.pic || '?').charAt(0)}
                  </div>
                  <span className="text-gray-900 dark:text-white font-medium truncate">{task.pic || task.picId || 'Unassigned'}</span>
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Deadline</label>
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700/50 text-gray-900 dark:text-white font-medium">
                  <span className="material-symbols-outlined text-gray-400">calendar_today</span>
                  {task.deadline || '--/--/----'}
                </div>
              </div>
            </div>

            {/* Tài liệu đính kèm (Download ẩn URL) */}
            {(task.attachment_url || task.file_url) && (
               <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tài liệu / Biên bản nghiệm thu</label>
                  <button 
                    onClick={() => handleDownloadAttachment(task.attachment_url || task.file_url, task.file_name || 'tai-lieu-dinh-kem')}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg transition border border-blue-200 dark:border-blue-800/50"
                  >
                    <span className="material-symbols-outlined">download</span>
                    <span className="text-sm font-medium">{task.file_name || 'Tải xuống tệp tin bảo mật'}</span>
                  </button>
               </div>
            )}
          </div>
        </div>

        {/* CỘT PHẢI: LỊCH SỬ BÌNH LUẬN (READ-ONLY) */}
        <div className="w-full md:w-2/5 flex flex-col bg-gray-50 dark:bg-[#1a1a1a]">
          <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-white dark:bg-[#1e1e1e]">
            <h3 className="font-bold text-sm flex items-center gap-2 dark:text-white">
              <span className="material-symbols-outlined text-primary">forum</span> Log Thảo luận
            </h3>
            <button onClick={onClose} className="hidden md:block text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[40vh] md:max-h-none">
            {loadingComments ? (
               <div className="flex justify-center items-center h-full">
                 <span className="material-symbols-outlined animate-spin text-3xl text-primary">autorenew</span>
               </div>
            ) : comments.length === 0 ? (
               <div className="text-center text-gray-400 text-sm italic mt-8">Chưa có bình luận nào được ghi nhận.</div>
            ) : (
               comments.map(c => (
                 <div key={c.id} className="flex gap-3">
                   <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                     {c.user_name ? c.user_name.substring(0, 1).toUpperCase() : 'U'}
                   </div>
                   <div className="p-3 rounded-2xl text-sm dark:text-gray-200 w-full max-w-[85%] bg-white dark:bg-[#2a2a2a] rounded-tl-none border border-outline-variant dark:border-gray-800 shadow-sm">
                     <div className="flex items-center gap-2 mb-1">
                       <span className="font-bold text-[11px]">{c.user_name || 'Hệ thống'}</span>
                       {c.user_role && <span className="text-[9px] bg-gray-100 dark:bg-black/20 px-1.5 py-0.5 rounded-full text-gray-700 dark:text-gray-300">{c.user_role}</span>}
                     </div>
                     <div className="break-words leading-relaxed text-[13px]">{c.content}</div>
                     <span className="text-[9px] opacity-60 block mt-1 text-right">
                       {new Date(c.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}
                     </span>
                   </div>
                 </div>
               ))
            )}
          </div>
          
          {/* MÁY CHÉM: KHÓA BÌNH LUẬN TRONG LỊCH SỬ */}
          <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-gray-100 dark:bg-[#252525]">
             <div className="w-full px-4 py-3 bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-center flex items-center justify-center gap-2 cursor-not-allowed select-none">
                <span className="material-symbols-outlined text-[18px]">block</span>
                Tính năng bình luận đã bị khóa
             </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
