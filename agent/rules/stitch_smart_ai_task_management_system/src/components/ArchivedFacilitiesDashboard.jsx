import React from 'react';

export default function ArchivedFacilitiesDashboard({ facilityList, showToast, refreshFacilities }) {
       const archivedFacs = facilityList.filter(f => f.is_active === false);

       const handleRestore = async (fac) => {
          try {
             const token = localStorage.getItem('taskflow_token');
             const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/facilities/${fac.id}/restore`, { 
                method: 'PUT',
                headers: { 
                   'Authorization': `Bearer ${token}`,
                   'x-user-role': user?.role || '',
                   'x-facility-id': user?.facility_id || ''
                }
             });
             const data = await res.json();
             if (data.success) {
                showToast('✅ Đã khôi phục cơ sở thành công!');
                if (refreshFacilities) refreshFacilities();
             }
          } catch {
             const localFacs = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
             const facIndex = localFacs.findIndex(f => f.id === fac.id);
             if (facIndex > -1) {
                localFacs[facIndex].is_active = true;
                localStorage.setItem('taskflow_facilities', JSON.stringify(localFacs));
                showToast('✅ Đã khôi phục cơ sở thành công (Offline)!');
                if (refreshFacilities) refreshFacilities();
             }
          }
       };

       return (
          <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-y-auto custom-scrollbar h-[calc(100vh-120px)] animate-fade-in">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-gray-100 dark:border-gray-800 pb-4">
                <div>
                   <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                     <span className="material-symbols-outlined text-gray-500">archive</span> Dữ liệu Lưu trữ
                   </h2>
                   <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Quản lý các cơ sở đã ngừng hoạt động hoặc bị lưu trữ</p>
                </div>
             </div>

             <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm text-left">
                   <thead className="bg-gray-50 dark:bg-[#252525] text-gray-700 dark:text-gray-300">
                      <tr>
                         <th className="px-6 py-4 font-bold">Mã Cơ Sở</th>
                         <th className="px-6 py-4 font-bold">Tên Cơ Sở</th>
                         <th className="px-6 py-4 font-bold">Trạng Thái</th>
                         <th className="px-6 py-4 font-bold text-right">Thao tác</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {archivedFacs.length === 0 ? (
                         <tr><td colSpan="4" className="text-center py-6 text-gray-500">Không có cơ sở nào trong lưu trữ</td></tr>
                      ) : archivedFacs.map(fac => (
                         <tr key={fac.id} className="hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors opacity-70">
                            <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{fac.id}</td>
                            <td className="px-6 py-4 font-bold text-gray-900 dark:text-white flex items-center gap-3">
                               <span className="material-symbols-outlined text-gray-400">domain_disabled</span>
                               {fac.name}
                            </td>
                            <td className="px-6 py-4">
                               <span className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-md text-xs font-bold">Đã lưu trữ</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                               <button onClick={() => handleRestore(fac)} className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 rounded-lg text-xs font-bold transition flex items-center gap-1 inline-flex">
                                  <span className="material-symbols-outlined text-[16px]">restore</span> Khôi phục
                               </button>
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          </div>
       );
    }
