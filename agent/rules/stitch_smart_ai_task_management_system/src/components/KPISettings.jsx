import React from 'react';

export default function KPISettings({ user, facilityList, showToast, refreshFacilities }) {
       const [kpis, setKpis] = React.useState({});
       const [applyMonth, setApplyMonth] = React.useState('');
       const [showAddFacModal, setShowAddFacModal] = React.useState(false);
       const [newFacName, setNewFacName] = React.useState('');
       const [isAddingFac, setIsAddingFac] = React.useState(false);
       
       const defaultFacs = facilityList.length > 0 ? facilityList : Array.from({length: 6}, (_, i) => ({id: `f${i+1}`, name: `Cơ sở ${i+1}`}));

       React.useEffect(() => {
          const now = new Date();
          const currentMonth = `${now.getMonth() + 1}/${now.getFullYear()}`;
          setApplyMonth(currentMonth);

          const savedKpis = JSON.parse(localStorage.getItem('taskflow_facility_kpis') || '{}');
          
          const initialKpis = {};
          defaultFacs.forEach(f => {
             initialKpis[f.id] = savedKpis[f.id] || {
                facility_id: f.id,
                name: f.name,
                weekday_target: 5000000,
                weekend_target: 8000000,
             };
          });
          setKpis(initialKpis);
       }, [facilityList]);

       const handleSave = () => {
          const dataToSave = {};
          Object.values(kpis).forEach(k => {
             dataToSave[k.facility_id] = {
                ...k,
                apply_month: applyMonth,
                updated_at: Date.now(),
                updated_by: user.name
             };
          });
          localStorage.setItem('taskflow_facility_kpis', JSON.stringify(dataToSave));
          showToast('✅ Đã lưu cấu hình KPI thành công!');
       };

       const handleArchiveFacility = async (fac) => {
          const facId = fac.facility_id || fac.id;
          if (!window.confirm(`Bạn có chắc muốn lưu trữ cơ sở "${fac.name}"? Dữ liệu lịch sử vẫn sẽ được giữ nguyên.`)) return;

          setKpis(prev => {
             const next = { ...prev };
             delete next[facId];
             return next;
          });

          try {
             const res = await fetch(`http://localhost:5001/api/facilities/${facId}/archive`, { method: 'PUT' });
             const data = await res.json();
             if (data.success) {
                showToast('✅ Đã lưu trữ cơ sở thành công!');
                if (refreshFacilities) refreshFacilities();
             } else {
                showToast('❌ Lỗi: ' + data.error);
             }
          } catch(err) {
             const localFacs = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
             const facIndex = localFacs.findIndex(f => f.id === facId);
             if (facIndex > -1) {
                localFacs[facIndex].is_active = false;
                localStorage.setItem('taskflow_facilities', JSON.stringify(localFacs));
                showToast('✅ Đã lưu trữ cơ sở thành công (Offline)!');
                if (refreshFacilities) refreshFacilities();
             }
          }
       };

       const handleAddFacility = async () => {
          if (!newFacName.trim()) {
             showToast('⚠️ Vui lòng nhập tên cơ sở!');
             return;
          }
          setIsAddingFac(true);
          try {
             const res = await fetch('http://localhost:5001/api/facilities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newFacName })
             });
             const data = await res.json();
             if (data.success) {
                showToast('✅ Thêm cơ sở thành công!');
                setNewFacName('');
                setShowAddFacModal(false);
                if (refreshFacilities) refreshFacilities();
             } else {
                showToast('❌ Lỗi: ' + data.error);
             }
          } catch (err) {
             const localFacs = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
             const newFac = { id: 'f' + Date.now(), name: newFacName.trim().toUpperCase() };
             localFacs.push(newFac);
             localStorage.setItem('taskflow_facilities', JSON.stringify(localFacs));
             showToast('✅ Thêm cơ sở thành công (Offline)!');
             setNewFacName('');
             setShowAddFacModal(false);
             if (refreshFacilities) refreshFacilities();
          }
          setIsAddingFac(false);
       };

       const handleInputChange = (id, field, value) => {
          const numValue = Number(value.replace(/\D/g, '')) || 0;
          setKpis(prev => ({
             ...prev,
             [id]: { ...prev[id], [field]: numValue }
          }));
       };

       const formatNum = (val) => new Intl.NumberFormat('vi-VN').format(val);

       return (
          <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-y-auto custom-scrollbar h-[calc(100vh-120px)] animate-fade-in">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-gray-100 dark:border-gray-800 pb-4">
                <div>
                   <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                     <span className="material-symbols-outlined text-teal-600">track_changes</span> Cài đặt Chỉ tiêu KPI Doanh Thu
                   </h2>
                   <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Cấu hình doanh thu kỳ vọng cho Ngày thường và Cuối tuần</p>
                </div>
                <div className="flex items-center gap-4">
                   <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Áp dụng từ:</span>
                      <select 
                         value={applyMonth} 
                         onChange={e => setApplyMonth(e.target.value)}
                         className="bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 outline-none focus:border-teal-500 text-sm font-medium dark:text-white"
                      >
                         <option value={applyMonth}>{applyMonth}</option>
                      </select>
                   </div>
                   <button onClick={() => setShowAddFacModal(true)} className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                      <span className="material-symbols-outlined text-[18px]">add</span> Thêm Cơ Sở Mới
                   </button>
                   <button onClick={handleSave} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                      <span className="material-symbols-outlined text-[18px]">save</span> Lưu Cấu Hình
                   </button>
                </div>
             </div>

             <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm text-left">
                   <thead className="bg-gray-50 dark:bg-[#252525] text-gray-700 dark:text-gray-300">
                      <tr>
                         <th className="px-6 py-4 font-bold w-1/3">Tên Cơ Sở</th>
                         <th className="px-6 py-4 font-bold text-center">KPI Ngày thường (CN - T5)</th>
                         <th className="px-6 py-4 font-bold text-center">KPI Cuối tuần (T6 - T7)</th>
                         <th className="px-6 py-4 font-bold text-center w-20">Thao tác</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {Object.values(kpis).map(k => (
                         <tr key={k.facility_id} className="hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors">
                            <td className="px-6 py-4 font-bold text-gray-900 dark:text-white flex items-center gap-3">
                               <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                               {k.name}
                            </td>
                            <td className="px-6 py-4">
                               <div className="relative max-w-[200px] mx-auto">
                                  <input 
                                     type="text" 
                                     value={formatNum(k.weekday_target)}
                                     onChange={e => handleInputChange(k.facility_id, 'weekday_target', e.target.value)}
                                     className="w-full bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-right outline-none focus:border-teal-500 font-medium text-gray-900 dark:text-white"
                                     maxLength="15"
                                  />
                               </div>
                            </td>
                            <td className="px-6 py-4">
                               <div className="relative max-w-[200px] mx-auto">
                                  <input 
                                     type="text" 
                                     value={formatNum(k.weekend_target)}
                                     onChange={e => handleInputChange(k.facility_id, 'weekend_target', e.target.value)}
                                     className="w-full bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-right outline-none focus:border-teal-500 font-medium text-gray-900 dark:text-white"
                                     maxLength="15"
                                  />
                               </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                               <button onClick={() => handleArchiveFacility(k)} className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Lưu trữ cơ sở">
                                  <span className="material-symbols-outlined text-[20px]">archive</span>
                               </button>
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>

             {showAddFacModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                   <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in border border-gray-200 dark:border-gray-800">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Thêm Cơ Sở Mới</h3>
                      <input 
                         type="text" 
                         autoFocus
                         value={newFacName}
                         onChange={e => setNewFacName(e.target.value)}
                         placeholder="Nhập tên cơ sở (VD: DUBAI 88)"
                         className="w-full bg-gray-50 dark:bg-[#252525] border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 outline-none focus:border-teal-500 font-medium text-gray-900 dark:text-white mb-6 uppercase"
                      />
                      <div className="flex gap-3 justify-end">
                         <button onClick={() => setShowAddFacModal(false)} className="px-4 py-2 text-sm font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">Hủy</button>
                         <button onClick={handleAddFacility} disabled={isAddingFac} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold transition flex items-center gap-2">
                            {isAddingFac ? 'Đang thêm...' : 'Lưu Cơ Sở'}
                         </button>
                      </div>
                   </div>
                </div>
             )}
          </div>
       );
    }
