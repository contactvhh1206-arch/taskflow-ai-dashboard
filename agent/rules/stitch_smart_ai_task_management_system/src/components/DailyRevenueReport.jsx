import React, { useState, useEffect, useCallback } from 'react';

export default function DailyRevenueReport({ user, facilityList, showToast }) {
  // Hàm để lấy ngày hôm qua định dạng YYYY-MM-DD
  const getYesterdayDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };

  const [selectedDate, setSelectedDate] = useState(getYesterdayDate());
  const [formData, setFormData] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [kpiTrigger, setKpiTrigger] = useState(0);

  useEffect(() => {
     const handler = () => setKpiTrigger(prev => prev + 1);
     window.addEventListener('taskflow_kpis_updated', handler);
     return () => window.removeEventListener('taskflow_kpis_updated', handler);
  }, []);

  // Lấy danh sách cơ sở
  const getActiveFacilities = useCallback(() => {
    if (facilityList && facilityList.length > 0) {
      return facilityList.filter(f => f.is_active !== false && !f.isExecutive);
    }
    // Fallback if no list provided
    return Array.from({length: 6}, (_, i) => ({
      id: `f${i+1}`,
      name: `Cơ sở ${i+1}`
    }));
  }, [facilityList]);

  const loadDataForDate = useCallback(async (dateStr) => {
    try {
      const token = localStorage.getItem('taskflow_token');
      // Import fetchReports dynamically to avoid circular dependency if any, or use from import
      const { fetchReports } = await import('../services/dataService.js');
      const allReports = await fetchReports(token, user?.role, user?.facility_id) || [];
      const existingReport = allReports.find(r => r.date === dateStr);
      
      const activeFacs = getActiveFacilities();
      
      if (existingReport && existingReport.data) {
        // Merge dữ liệu cũ với danh sách cơ sở hiện tại
        const mergedData = activeFacs.map(fac => {
          const existingFacData = existingReport.data.find(d => d.id === fac.id || d.name === fac.name);
          return {
            id: fac.id,
            name: fac.name,
            revenue: existingFacData ? existingFacData.revenue : 0,
            note: existingFacData ? (existingFacData.note || '') : ''
          };
        });
        setFormData(mergedData);
      } else {
        // Khởi tạo mới
        const initialData = activeFacs.map(fac => ({
          id: fac.id,
          name: fac.name,
          revenue: 0,
          note: ''
        }));
        setFormData(initialData);
      }
    } catch (e) {
      console.error(e);
    }
  }, [getActiveFacilities, user]);

  useEffect(() => {
    loadDataForDate(selectedDate);
  }, [selectedDate, loadDataForDate]);

  const handleRevenueChange = (id, value) => {
    // Chỉ cho phép nhập số
    const numValue = value.replace(/\D/g, '');
    setFormData(prev => prev.map(item => item.id === id ? { ...item, revenue: numValue } : item));
  };

  const handleNoteChange = (id, value) => {
    setFormData(prev => prev.map(item => item.id === id ? { ...item, note: value } : item));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { saveReport } = await import('../services/dataService.js');
      
      // Tính tổng doanh thu
      const totalRev = formData.reduce((acc, curr) => acc + Number(curr.revenue || 0), 0);
      
      // Tạo object report mới
      const newReport = {
        id: 'rep_' + Date.now() + Math.random().toString(36).substr(2, 5),
        date: selectedDate,
        totalRevenue: totalRev,
        data: formData.map(d => ({
           ...d,
           revenue: Number(d.revenue || 0)
        })),
        createdBy: user?.name || user?.username || 'Finance Dept',
        timestamp: Date.now()
      };
      
      const token = localStorage.getItem('taskflow_token');
      const success = await saveReport(newReport, token, user?.role, user?.facility_id);
      
      if (success) {
        if (showToast) showToast('Đã lưu Báo cáo Doanh thu thành công!', 'success');
      } else {
        if (showToast) showToast('Có lỗi xảy ra khi lưu trên Server!', 'error');
      }
    } catch {
      if (showToast) showToast('Có lỗi xảy ra khi lưu!', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (value) => {
    if (!value && value !== 0) return '0 đ';
    return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
  };

  const totalCurrentRevenue = formData.reduce((acc, curr) => acc + Number(curr.revenue || 0), 0);

  return (
    <div className="flex flex-col gap-6 p-6 h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar bg-gray-50 dark:bg-[#121212] animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-green-600">assessment</span> Báo cáo Doanh thu Hằng ngày
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Nhập số liệu kinh doanh của các cơ sở. Mặc định là doanh thu của ngày hôm qua.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Ngày báo cáo:</label>
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]} // Không cho nhập ngày tương lai
            className="bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 outline-none focus:border-primary text-sm font-medium dark:text-white transition-colors cursor-pointer"
          />
        </div>
      </div>

      <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="p-5 border-b border-outline-variant dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 flex justify-between items-center">
           <div>
             <h3 className="font-bold text-gray-800 dark:text-gray-200">Bảng Nhập Liệu</h3>
             <p className="text-xs text-gray-500 mt-1">Hỗ trợ tối đa 6 cơ sở đang hoạt động</p>
           </div>
           <div className="text-right">
             <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Tổng doanh thu dự tính</p>
             <p className="text-xl font-black text-green-600 dark:text-green-500">{formatCurrency(totalCurrentRevenue)}</p>
           </div>
        </div>
        
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
           {formData.length === 0 ? (
             <div className="flex justify-center py-10 text-gray-500 italic">Không tìm thấy cơ sở nào hoạt động.</div>
           ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {formData.map((item, index) => (
                 <div key={item.id} className="bg-gray-50 dark:bg-[#252525] p-5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-primary/50 transition-colors focus-within:ring-2 focus-within:ring-primary/20">
                   <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                     <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black">{index + 1}</span>
                     {item.name}
                   </h4>
                   
                   <div className="space-y-4">
                     <div>
                       <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Doanh thu (VNĐ)</label>
                       <div className="relative">
                         <input 
                           type="text" 
                           value={item.revenue === 0 && !String(item.revenue) ? '' : new Intl.NumberFormat('vi-VN').format(item.revenue)}
                           onChange={(e) => handleRevenueChange(item.id, e.target.value)}
                           className="w-full bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg pl-4 pr-10 py-2.5 text-right font-mono font-bold text-gray-800 dark:text-gray-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                           placeholder="0"
                         />
                         <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">đ</span>
                       </div>
                     </div>
                     
                     <div>
                       <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Ghi chú (Tùy chọn)</label>
                       <input 
                         type="text" 
                         value={item.note}
                         onChange={(e) => handleNoteChange(item.id, e.target.value)}
                         className="w-full bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-primary transition-all placeholder-gray-400"
                         placeholder="Nhập ghi chú..."
                       />
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           )}
        </div>
        
        <div className="p-4 border-t border-outline-variant dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-end">
           <button 
             onClick={handleSave} 
             disabled={isSaving}
             className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-white shadow-md transition-all ${isSaving ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 hover:shadow-lg active:scale-95'}`}
           >
             {isSaving ? (
               <><span className="material-symbols-outlined animate-spin">refresh</span> Đang lưu...</>
             ) : (
               <><span className="material-symbols-outlined">save</span> Lưu Báo Cáo</>
             )}
           </button>
        </div>
      </div>
    </div>
  );
}
