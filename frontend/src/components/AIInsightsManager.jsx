import React, { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';
const TOKEN = () => localStorage.getItem('taskflow_token');

const CATEGORY_META = {
    operations: { label: 'Vận hành', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: 'engineering' },
    revenue:    { label: 'Doanh thu', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', icon: 'payments' },
    directive:  { label: 'Chỉ thị', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: 'gavel' },
    incident:   { label: 'Sự cố', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', icon: 'warning' },
    preference: { label: 'Sở thích', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', icon: 'tune' },
};

const ImportanceDots = ({ value }) => (
    <div className="flex items-center gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
            <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i < value
                        ? value >= 8 ? 'bg-red-500' : value >= 5 ? 'bg-amber-400' : 'bg-blue-400'
                        : 'bg-gray-200 dark:bg-gray-700'
                }`}
            />
        ))}
        <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400 font-mono">{value}/10</span>
    </div>
);

export default function AIInsightsManager({ showToast }) {
    const [insights, setInsights]       = useState([]);
    const [pagination, setPagination]   = useState({ total: 0, page: 1, totalPages: 1 });
    const [isLoading, setIsLoading]     = useState(true);
    const [filterCategory, setFilterCategory] = useState('');
    const [filterActive, setFilterActive]     = useState('');
    const [togglingId, setTogglingId]   = useState(null);
    const [deletingId, setDeletingId]   = useState(null);
    const [confirmDelete, setConfirmDelete]   = useState(null); // id bài học đang chờ confirm

    const fetchInsights = useCallback(async (page = 1) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ page, limit: 20 });
            if (filterCategory) params.append('category', filterCategory);
            if (filterActive !== '')  params.append('is_active', filterActive);

            const res = await fetch(`${API_BASE_URL}/api/rag/insights?${params}`, {
                headers: { Authorization: `Bearer ${TOKEN()}` }
            });
            const data = await res.json();
            if (data.success) {
                setInsights(data.data);
                setPagination(data.pagination);
            } else {
                showToast?.('Không tải được danh sách bài học.');
            }
        } catch (e) {
            console.error('fetchInsights error:', e);
            showToast?.('Lỗi kết nối server.');
        } finally {
            setIsLoading(false);
        }
    }, [filterCategory, filterActive]);

    useEffect(() => { fetchInsights(1); }, [fetchInsights]);

    const handleToggle = async (id) => {
        setTogglingId(id);
        try {
            const res = await fetch(`${API_BASE_URL}/api/rag/insights/${id}/toggle`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${TOKEN()}` }
            });
            const data = await res.json();
            if (data.success) {
                setInsights(prev => prev.map(i => i.id === id ? { ...i, is_active: data.data.is_active } : i));
                showToast?.(data.data.is_active ? '✅ Bài học đã được kích hoạt.' : '⏸ Bài học đã tạm vô hiệu hoá.');
            }
        } catch (e) {
            showToast?.('Lỗi khi thay đổi trạng thái.');
        } finally {
            setTogglingId(null);
        }
    };

    const handleDelete = async (id) => {
        setDeletingId(id);
        setConfirmDelete(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/rag/insights/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${TOKEN()}` }
            });
            const data = await res.json();
            if (data.success) {
                setInsights(prev => prev.filter(i => i.id !== id));
                setPagination(prev => ({ ...prev, total: prev.total - 1 }));
                showToast?.('🗑 Đã xóa bài học vĩnh viễn.');
            }
        } catch (e) {
            showToast?.('Lỗi khi xóa bài học.');
        } finally {
            setDeletingId(null);
        }
    };

    const formatDate = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        <span className="material-symbols-outlined text-indigo-500">psychology</span>
                        Quản lý Bài học AI
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Các tri thức được Cố vấn AI tự trích xuất từ lịch sử hội thoại quản trị.
                        Tổng cộng <span className="font-semibold text-indigo-600 dark:text-indigo-400">{pagination.total}</span> bài học.
                    </p>
                </div>
                <button
                    onClick={() => fetchInsights(pagination.page)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                    <span className="material-symbols-outlined text-[16px]">refresh</span>
                    Tải lại
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-gray-400 text-[18px]">filter_list</span>
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Lọc:</span>
                </div>

                <select
                    value={filterCategory}
                    onChange={e => setFilterCategory(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-[#252525] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                    <option value="">Tất cả loại</option>
                    {Object.entries(CATEGORY_META).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                    ))}
                </select>

                <select
                    value={filterActive}
                    onChange={e => setFilterActive(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-[#252525] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                    <option value="">Tất cả trạng thái</option>
                    <option value="true">✅ Đang hoạt động</option>
                    <option value="false">⏸ Đã vô hiệu hoá</option>
                </select>

                {(filterCategory || filterActive !== '') && (
                    <button
                        onClick={() => { setFilterCategory(''); setFilterActive(''); }}
                        className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                    >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                        Xoá lọc
                    </button>
                )}
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin mb-4" />
                    <p className="text-sm">Đang tải bài học...</p>
                </div>
            ) : insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <span className="material-symbols-outlined text-5xl mb-3 text-gray-300">psychology_alt</span>
                    <p className="text-sm font-medium">Chưa có bài học nào.</p>
                    <p className="text-xs mt-1">Cron sẽ trích xuất bài học từ đêm nay.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {insights.map(insight => {
                        const cat = CATEGORY_META[insight.category] || CATEGORY_META.operations;
                        const isBeingToggled = togglingId === insight.id;
                        const isBeingDeleted = deletingId === insight.id;

                        return (
                            <div
                                key={insight.id}
                                className={`relative p-4 rounded-xl border transition-all ${
                                    insight.is_active
                                        ? 'bg-white dark:bg-[#1e1e1e] border-gray-200 dark:border-gray-700'
                                        : 'bg-gray-50 dark:bg-[#181818] border-gray-200 dark:border-gray-800 opacity-60'
                                }`}
                            >
                                {/* Top row */}
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {/* Category badge */}
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${cat.color}`}>
                                            <span className="material-symbols-outlined text-[13px]">{cat.icon}</span>
                                            {cat.label}
                                        </span>
                                        {/* Active badge */}
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                            insight.is_active
                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                : 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
                                        }`}>
                                            <span className="material-symbols-outlined text-[12px]">{insight.is_active ? 'check_circle' : 'pause_circle'}</span>
                                            {insight.is_active ? 'Hoạt động' : 'Vô hiệu'}
                                        </span>
                                        {/* Directive global flag */}
                                        {insight.category === 'directive' && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800">
                                                <span className="material-symbols-outlined text-[12px]">public</span>
                                                Toàn hệ thống
                                            </span>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleToggle(insight.id)}
                                            disabled={isBeingToggled || isBeingDeleted}
                                            title={insight.is_active ? 'Vô hiệu hoá' : 'Kích hoạt'}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                insight.is_active
                                                    ? 'bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-400'
                                                    : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 dark:text-emerald-400'
                                            } disabled:opacity-50`}
                                        >
                                            {isBeingToggled ? (
                                                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[14px]">
                                                    {insight.is_active ? 'pause_circle' : 'play_circle'}
                                                </span>
                                            )}
                                            {insight.is_active ? 'Vô hiệu' : 'Kích hoạt'}
                                        </button>

                                        <button
                                            onClick={() => setConfirmDelete(insight.id)}
                                            disabled={isBeingToggled || isBeingDeleted}
                                            title="Xóa vĩnh viễn"
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors disabled:opacity-50"
                                        >
                                            {isBeingDeleted ? (
                                                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[14px]">delete</span>
                                            )}
                                            Xoá
                                        </button>
                                    </div>
                                </div>

                                {/* Insight text */}
                                <p className="mt-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                                    {insight.insight_text}
                                </p>

                                {/* Bottom metadata */}
                                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <div className="flex items-center gap-1">
                                        <span className="text-xs text-gray-400 dark:text-gray-500">Độ quan trọng:</span>
                                        <ImportanceDots value={insight.importance || 5} />
                                    </div>
                                    <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[13px]">schedule</span>
                                        {formatDate(insight.created_at)}
                                    </span>
                                    {insight.source_facility_id && (
                                        <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[13px]">home_work</span>
                                            Cơ sở #{insight.source_facility_id}
                                        </span>
                                    )}
                                    <span className="text-xs text-gray-300 dark:text-gray-600 font-mono">
                                        ID#{insight.id}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                        onClick={() => fetchInsights(pagination.page - 1)}
                        disabled={pagination.page <= 1 || isLoading}
                        className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                        ← Trước
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                        Trang <span className="font-semibold">{pagination.page}</span> / {pagination.totalPages}
                    </span>
                    <button
                        onClick={() => fetchInsights(pagination.page + 1)}
                        disabled={pagination.page >= pagination.totalPages || isLoading}
                        className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                        Sau →
                    </button>
                </div>
            )}

            {/* Confirm Delete Modal */}
            {confirmDelete !== null && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <span className="material-symbols-outlined text-red-600 dark:text-red-400">warning</span>
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-gray-100">Xác nhận xóa</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Hành động này không thể hoàn tác.</p>
                            </div>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">
                            Bài học sẽ bị <strong>xóa vĩnh viễn</strong> khỏi hệ thống. AI sẽ không còn sử dụng tri thức này nữa.
                            Nếu chỉ muốn tạm dừng, hãy dùng nút <strong>Vô hiệu</strong> thay thế.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setConfirmDelete(null)}
                                className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                                Huỷ
                            </button>
                            <button
                                onClick={() => handleDelete(confirmDelete)}
                                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
                            >
                                Xoá vĩnh viễn
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
