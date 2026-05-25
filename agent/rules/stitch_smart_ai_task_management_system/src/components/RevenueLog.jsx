import React, { useState, useEffect, useCallback } from 'react';

export default function RevenueLog({ user, showToast }) {
  const [reports, setReports] = useState([]);
  const [editingReport, setEditingReport] = useState(null);
  const [editFormData, setEditFormData] = useState([]);
  const [editReason, setEditReason] = useState('');

  const loadReports = useCallback(async () => {
    try {
      const token = localStorage.getItem('taskflow_token');
      const { fetchReports } = await import('../services/dataService.js');
      const allReports = await fetchReports(token, user?.role, user?.facility_id) || [];
      // Sort descending by timestamp
      allReports.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setReports(allReports);
    } catch (e) {
      console.error(e);
    }
  }, [user]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleEditClick = (report) => {
    setEditingReport(report);
    // Deep copy data for editing
    setEditFormData(JSON.parse(JSON.stringify(report.data || [])));
    setEditReason('');
  };

  const closeEditModal = () => {
    setEditingReport(null);
    setEditFormData([]);
    setEditReason('');
  };

  const handleRevenueChange = (id, value) => {
    const numValue = value.replace(/\D/g, '');
    setEditFormData(prev => prev.map(item => item.id === id ? { ...item, revenue: numValue } : item));
  };

  const handleSaveEdit = async () => {
    if (!editReason.trim()) {
      alert("Vui lòng nhập lý do chỉnh sửa (bắt buộc)!");
      return;
    }

    try {
      const { saveReport } = await import('../services/dataService.js');
      const token = localStorage.getItem('taskflow_token');
      
      const oldTotal = editingReport.totalRevenue;
      const newTotal = editFormData.reduce((acc, curr) => acc + Number(curr.revenue || 0), 0);
      
      // Update the report data
      const updatedReport = {
        ...editingReport,
        totalRevenue: newTotal,
        data: editFormData.map(d => ({ ...d, revenue: Number(d.revenue || 0) }))
      };

      // Add to edit history
      if (!updatedReport.editHistory) {
        updatedReport.editHistory = [];
      }
      updatedReport.editHistory.push({
        editedAt: Date.now(),
        editedBy: user?.name || user?.username || 'Finance Dept',
        reason: editReason,
        oldTotal: oldTotal,
        newTotal: newTotal
      });

      const success = await saveReport(updatedReport, token, user?.role, user?.facility_id);
      
      if (success) {
        if (showToast) showToast('Đã lưu thay đổi thành công!', 'success');
        loadReports();
        closeEditModal();
      } else {
        if (showToast) showToast('Lỗi khi lưu dữ liệu lên máy chủ!', 'error');
      }
    } catch {
      if (showToast) showToast('Lỗi khi lưu dữ liệu!', 'error');
    }
  };

  const formatCurrency = (value) => {
    if (!value && value !== 0) return '0 đ';
    return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const d = new Date(timestamp);
    return `${d.toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})} - ${d.toLocaleDateString('vi-VN')}`;
  };

  const handleMigrateData = async () => {
    if (!window.confirm('Bạn có chắc muốn đồng bộ tất cả dữ liệu cũ từ trình duyệt này lên Server? Dữ liệu trên Server sẽ được cập nhật.')) return;
    const allLocalReports = JSON.parse(localStorage.getItem('taskflow_daily_financial_reports') || '[]');
    if (allLocalReports.length === 0) {
      alert('Không có dữ liệu nội bộ (localStorage) nào để đồng bộ.');
      return;
    }
    
    try {
      const { saveReport } = await import('../services/dataService.js');
      const token = localStorage.getItem('taskflow_token');
      const success = await saveReport(allLocalReports, token, user?.role, user?.facility_id);
      if (success) {
        if (showToast) showToast(`Đã đồng bộ ${allLocalReports.length} bản ghi thành công!`, 'success');
        loadReports();
      } else {
        if (showToast) showToast('Lỗi đồng bộ lên máy chủ!', 'error');
      }
    } catch (e) {
      console.error(e);
      if (showToast) showToast('Lỗi khi đồng bộ!', 'error');
    }
  };

  const totalEditRevenue = editFormData.reduce((acc, curr) => acc + Number(curr.revenue || 0), 0);

  return (
    <div className="flex flex-col gap-6 p-6 h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar bg-gray-50 dark:bg-[#121212] animate-fade-in relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-600">history</span> Nhật ký Doanh thu
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Lịch sử lưu trữ các bản ghi doanh thu theo ngày trên Database.
          </p>
        </div>
        <div>
          <button 
            onClick={handleMigrateData}
            className="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 rounded-lg font-bold text-sm transition-colors border border-orange-200 dark:border-orange-800"
          >
            <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
            Đồng bộ LocalStorage lên Database
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-800/50 border-b border-outline-variant dark:border-gray-700">
              <tr>
                <th className="px-6 py-4 font-semibold">Ngày Báo Cáo</th>
                <th className="px-6 py-4 font-semibold">Ngày Giờ Nhập</th>
                <th className="px-6 py-4 font-semibold text-right">Tổng Doanh Thu</th>
                <th className="px-6 py-4 font-semibold">Người Nhập</th>
                <th className="px-6 py-4 font-semibold">Trạng Thái</th>
                <th className="px-6 py-4 font-semibold text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-12 text-gray-500 italic">Chưa có bản ghi doanh thu nào.</td>
                </tr>
              ) : (
                reports.map((report) => (
                  <tr key={report.id} className="border-b border-outline-variant dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4 font-bold text-gray-800 dark:text-gray-200">
                      {report.date.split('-').reverse().join('/')}
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {formatDateTime(report.timestamp)}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-green-600 dark:text-green-500">
                      {formatCurrency(report.totalRevenue)}
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                          {report.createdBy?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        {report.createdBy}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {report.editHistory && report.editHistory.length > 0 ? (
                        <span className="px-2.5 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full text-xs font-bold border border-yellow-200 dark:border-yellow-800/50">
                          Đã sửa ({report.editHistory.length} lần)
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded-full text-xs font-bold border border-green-200 dark:border-green-800/50">
                          Gốc
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button 
                        onClick={() => handleEditClick(report)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors inline-flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[18px]">edit</span> Sửa đổi
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/30">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-500">edit_document</span> 
                Sửa Báo Cáo ({editingReport.date.split('-').reverse().join('/')})
              </h3>
              <button onClick={closeEditModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              <div className="space-y-4 mb-6">
                {editFormData.map((item, index) => (
                  <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-[#252525] rounded-xl border border-gray-200 dark:border-gray-700">
                    <span className="font-bold text-gray-800 dark:text-gray-200 w-1/3">{item.name}</span>
                    <div className="relative w-full sm:w-2/3">
                      <input 
                        type="text" 
                        value={item.revenue === 0 && !String(item.revenue) ? '' : new Intl.NumberFormat('vi-VN').format(item.revenue)}
                        onChange={(e) => handleRevenueChange(item.id, e.target.value)}
                        className="w-full bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg pl-4 pr-10 py-2 text-right font-mono font-bold text-gray-800 dark:text-gray-200 focus:outline-none focus:border-blue-500 transition-all"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">đ</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 mb-6">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-700 dark:text-gray-300">Tổng doanh thu sau sửa:</span>
                  <span className="text-xl font-black text-blue-600 dark:text-blue-400">{formatCurrency(totalEditRevenue)}</span>
                </div>
                {editingReport.totalRevenue !== totalEditRevenue && (
                  <div className="text-xs text-right mt-1 text-gray-500">
                    Gốc: <span className="line-through">{formatCurrency(editingReport.totalRevenue)}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                  Lý do chỉnh sửa <span className="text-red-500">*</span>
                </label>
                <textarea 
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Ví dụ: Nhập sai số liệu chi nhánh 1, Kế toán chi nhánh báo nhầm..."
                  className="w-full bg-white dark:bg-[#1a1a1a] border border-red-300 dark:border-red-900/50 rounded-xl p-3 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all h-24 resize-none"
                ></textarea>
                <p className="text-xs text-red-500 font-medium">Bắt buộc nhập lý do để lưu vết kiểm toán.</p>
              </div>

              {/* Lịch sử chỉnh sửa trước đó nếu có */}
              {editingReport.editHistory && editingReport.editHistory.length > 0 && (
                <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="font-bold text-sm text-gray-600 dark:text-gray-400 mb-3 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">history</span> Lịch sử sửa trước đó
                  </h4>
                  <div className="space-y-3">
                    {editingReport.editHistory.map((hist, idx) => (
                      <div key={idx} className="bg-gray-50 dark:bg-[#252525] p-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
                        <div className="flex justify-between mb-1">
                          <span className="font-bold text-gray-700 dark:text-gray-300">{hist.editedBy}</span>
                          <span className="text-gray-500">{formatDateTime(hist.editedAt)}</span>
                        </div>
                        <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Lý do:</span> {hist.reason}</p>
                        <p className="text-gray-600 dark:text-gray-400 mt-1"><span className="font-medium">Thay đổi:</span> {formatCurrency(hist.oldTotal)} &rarr; {formatCurrency(hist.newTotal)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3">
              <button 
                onClick={closeEditModal}
                className="px-5 py-2 rounded-lg font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={handleSaveEdit}
                className="flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">save</span> Lưu Chỉnh Sửa
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
