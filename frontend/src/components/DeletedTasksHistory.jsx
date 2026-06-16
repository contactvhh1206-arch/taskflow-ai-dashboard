import React, { useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';

const DeletedTasksHistory = ({ user, showToast }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ total: 0, page: 1, total_pages: 1 });
  const [search, setSearch] = useState('');

  const fetchHistory = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('taskflow_token');
      const res = await fetch(`${API_URL}/api/tasks/deleted-history?page=${page}&limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setRecords(data.data || []);
        setMeta(data.meta || { total: 0, page: 1, total_pages: 1 });
      } else {
        showToast && showToast(data.error || 'Không thể tải lịch sử xóa', 'error');
      }
    } catch (e) {
      showToast && showToast('Lỗi kết nối server', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(1); }, [fetchHistory]);

  const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  };

  const priorityLabel = (p) => {
    if (!p) return '—';
    const map = { CRITICAL: { label: 'Khẩn cấp', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }, HIGH: { label: 'Cao', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }, MEDIUM: { label: 'Trung bình', cls: 'bg-yellow-100 text-yellow-700' }, LOW: { label: 'Thấp', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' } };
    const m = map[p] || { label: p, cls: 'bg-gray-100 text-gray-600' };
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>{m.label}</span>;
  };

  const filtered = records.filter(r => {
    if (!search.trim()) return true;
    const snap = r.task_snapshot || {};
    const q = search.toLowerCase();
    return (
      (snap.title || '').toLowerCase().includes(q) ||
      (snap.facility_name || '').toLowerCase().includes(q) ||
      (snap.pic_name || '').toLowerCase().includes(q) ||
      (r.deleted_by_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full w-full max-w-6xl mx-auto py-4 px-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-red-500">delete_sweep</span>
            Lịch sử xóa Task
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Toàn bộ task bị xóa vĩnh viễn — {meta.total} bản ghi
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">search</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm theo tiêu đề, cơ sở, người thực hiện..."
              className="pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e1e] text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-400 w-64 transition-all"
            />
          </div>
          <button
            onClick={() => fetchHistory(meta.page)}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Làm mới"
          >
            <span className="material-symbols-outlined text-gray-500 text-[20px]">refresh</span>
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <span className="material-symbols-outlined text-5xl animate-spin" style={{ animationDuration: '1.5s' }}>progress_activity</span>
            <p className="text-sm">Đang tải lịch sử...</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <span className="material-symbols-outlined text-6xl opacity-30">inbox</span>
            <p className="text-sm font-medium">{search ? 'Không tìm thấy kết quả phù hợp' : 'Chưa có task nào bị xóa'}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-[#1e1e1e]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#252525]">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider">Tiêu đề Task</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider hidden md:table-cell">Cơ sở / P.ban</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider hidden lg:table-cell">Người phụ trách</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider hidden lg:table-cell">Độ ưu tiên</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider">Người xóa</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider">Thời gian xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {filtered.map((r) => {
                  const snap = r.task_snapshot || {};
                  return (
                    <tr key={r.id} className="hover:bg-red-50/40 dark:hover:bg-red-900/10 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800 dark:text-gray-200 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors line-clamp-1">
                          {snap.title || `#${r.task_id}`}
                        </div>
                        {snap.description && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{snap.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-gray-600 dark:text-gray-400">
                          {snap.facility_name || snap.department_code || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-gray-600 dark:text-gray-400">{snap.pic_name || '—'}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {priorityLabel(snap.priority_level)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0">
                            {(r.deleted_by_name || 'S').substring(0, 1).toUpperCase()}
                          </div>
                          <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">{r.deleted_by_name || 'SUPER_ADMIN'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                        {formatDate(r.deleted_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta.total_pages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>{meta.total} bản ghi — Trang {meta.page}/{meta.total_pages}</span>
              <div className="flex gap-2">
                <button
                  disabled={meta.page <= 1}
                  onClick={() => fetchHistory(meta.page - 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  ← Trước
                </button>
                <button
                  disabled={meta.page >= meta.total_pages}
                  onClick={() => fetchHistory(meta.page + 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Sau →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DeletedTasksHistory;
