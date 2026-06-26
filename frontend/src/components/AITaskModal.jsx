import React, { useState } from 'react';

export default function AITaskModal({ onClose, onConfirm, user, initialText = '' }) {
  const [text, setText] = useState(initialText);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // [v2] Thêm bước Preview: draftTasks = null (chưa extract), [] (đã extract)
  const [draftTasks, setDraftTasks] = useState(null);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setIsAnalyzing(true);

    try {
      const API_URL = import.meta.env.VITE_API_URL
        ? `${import.meta.env.VITE_API_URL}/api/ai/auto-tasking`
        : 'https://taskflow-ai-dashboard.onrender.com/api/ai/auto-tasking';
      const token = JSON.parse(localStorage.getItem('taskflow_auth') || '{}').token;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-user-role': user.role,
          'x-facility-id': localStorage.getItem('facility_id') || user.facility_id || 'ALL'
        },
        body: JSON.stringify({
          meetingTranscript: text,
          facilityId: localStorage.getItem('facility_id') || user.facility_id || 'HQ'
        })
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Lỗi trích xuất AI');

      const parsedTasks = data.data;
      if (!Array.isArray(parsedTasks)) throw new Error('Invalid JSON format: Expected an array');

      const todayStr = new Date().toISOString().split('T')[0];
      const mappedTasks = parsedTasks.map(task => {
        let safeDeadline = task.deadline || todayStr;
        if (safeDeadline < todayStr) safeDeadline = todayStr;
        return {
          id: Date.now() + Math.random(),
          title: task.task_title || task.title || 'Task mới',
          desc: task.description || '',
          pic: typeof task.pic === 'string' ? task.pic : (user.name || ''),
          pic_id: task.pic_id,
          deadline: safeDeadline,
          status: 'todo',
          urgent: task.priority_level === 'URGENT' || task.priority === 'Cao',
          facility: task.facility_id || localStorage.getItem('facility_id') || (user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id),
          target_facility: task.target_facility || '',
          department_code: task.department_code || null,
          createdAt: new Date().toISOString().split('T')[0]
        };
      });

      // [v2] KHÔNG gọi onConfirm ngay — hiển thị Preview trước
      setDraftTasks(mappedTasks);
    } catch (error) {
      console.error('AI Error:', error);
      alert('AI không thể xử lý đoạn văn bản này, vui lòng thử lại.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // [v2] Sửa 1 trường trong preview table
  const handleEditDraft = (index, field, value) => {
    setDraftTasks(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  // [v2] Xác nhận sau khi sếp kiểm tra xong — chỉ khi này mới lưu DB
  const handleConfirm = () => {
    onConfirm(draftTasks);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-5xl rounded-2xl shadow-2xl border border-outline-variant dark:border-gray-800 flex flex-col max-h-[92vh] overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-gradient-to-r from-amber-500/10 to-transparent shrink-0">
          <h2 className="text-xl font-bold text-on-surface dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-500">bolt</span>
            Giao Việc Nhanh (AI)
            {draftTasks && (
              <span className="ml-2 text-sm font-normal text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-3 py-0.5 rounded-full border border-amber-200 dark:border-amber-700">
                Bước 2 / 2 — Kiểm tra trước khi lưu
              </span>
            )}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* Bước 1: Nhập nội dung */}
          {!draftTasks && (
            <div className="p-6 space-y-4">
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">info</span>
                <span>Dán biên bản họp hoặc chỉ thị vào đây. AI sẽ tự động tách ra từng task riêng cho từng cơ sở. Bạn sẽ được xem trước và chỉnh sửa trước khi lưu.</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full h-64 px-4 py-3 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/50 outline-none transition-all dark:text-white resize-none"
                placeholder="VD: Giao việc cho các cơ sở: kpi 10 ngày cuối tháng&#10;Mô tả: 10 ngày cuối tháng các cơ sở chạy nước rút...&#10;Pic: db41, dbpq, dbpa, dbpak, dbpav, dbace&#10;Deadline: 30/06/2026"
              />
              <button
                onClick={handleAnalyze}
                disabled={!text.trim() || isAnalyzing}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? (
                  <><span className="material-symbols-outlined animate-spin">sync</span> AI đang phân tích...</>
                ) : (
                  <><span className="material-symbols-outlined">auto_awesome</span> Phân tích & Trích xuất Task</>
                )}
              </button>
            </div>
          )}

          {/* Bước 2: Preview & Chỉnh sửa */}
          {draftTasks && (
            <div className="p-6 space-y-4">
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl text-sm text-green-800 dark:text-green-300 flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">check_circle</span>
                <span>AI đã trích xuất được <strong>{draftTasks.length} task</strong>. Kiểm tra lại thông tin bên dưới, chỉnh sửa nếu cần, rồi bấm <strong>Xác nhận & Lưu</strong>.</span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-outline-variant dark:border-gray-700">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 dark:bg-[#252525] border-b border-outline-variant dark:border-gray-700">
                    <tr>
                      <th className="px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 w-8">#</th>
                      <th className="px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 min-w-[160px]">Tiêu đề</th>
                      <th className="px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 min-w-[220px]">Mô tả chi tiết</th>
                      <th className="px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 min-w-[120px]">PIC</th>
                      <th className="px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 min-w-[110px]">Cơ sở</th>
                      <th className="px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 min-w-[130px]">Deadline</th>
                      <th className="px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 text-center w-20">Khẩn</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {draftTasks.map((task, idx) => (
                      <tr key={task.id} className="bg-white dark:bg-[#1e1e1e] hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                        <td className="px-3 py-2 text-gray-400 text-xs font-mono">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={task.title}
                            onChange={e => handleEditDraft(idx, 'title', e.target.value)}
                            className="w-full px-2 py-1.5 bg-surface-container-low dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <textarea
                            value={task.desc}
                            onChange={e => handleEditDraft(idx, 'desc', e.target.value)}
                            rows={3}
                            className="w-full px-2 py-1.5 bg-surface-container-low dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500 dark:text-white resize-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={task.pic}
                            onChange={e => handleEditDraft(idx, 'pic', e.target.value)}
                            className="w-full px-2 py-1.5 bg-surface-container-low dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={task.target_facility || task.facility || ''}
                            onChange={e => handleEditDraft(idx, 'target_facility', e.target.value)}
                            className="w-full px-2 py-1.5 bg-surface-container-low dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={task.deadline ? task.deadline.slice(0, 10) : ''}
                            onChange={e => handleEditDraft(idx, 'deadline', e.target.value)}
                            className="w-full px-2 py-1.5 bg-surface-container-low dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={!!task.urgent}
                            onChange={e => handleEditDraft(idx, 'urgent', e.target.checked)}
                            className="w-4 h-4 accent-red-500 cursor-pointer"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-outline-variant dark:border-gray-800 flex justify-between items-center shrink-0 bg-gray-50/50 dark:bg-[#1a1a1a]">
          {draftTasks ? (
            <>
              <button
                onClick={() => setDraftTasks(null)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span> Nhập lại
              </button>
              <button
                onClick={handleConfirm}
                disabled={!draftTasks || draftTasks.length === 0}
                className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md shadow-amber-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">save</span>
                Xác nhận & Lưu {draftTasks.length} Task
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              Đóng
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
