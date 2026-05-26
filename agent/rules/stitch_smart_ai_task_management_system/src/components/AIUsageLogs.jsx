import React, { useState, useEffect } from 'react';

export default function AIUsageLogs() {
      const [logs, setLogs] = useState([]);
      const [violations, setViolations] = useState([]);
      const [usersMap, setUsersMap] = useState({});
      
      useEffect(() => {
        let uMap = {};
        try {
          const usersArr = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
          usersArr.forEach(u => {
            uMap[u.id] = `${u.name} (${u.username})`;
          });
          setUsersMap(uMap);
        } catch {}
        
        const getName = (id, fallback) => uMap[id] || fallback;

        const mockLogs = [
          { id: 1, timestamp: new Date(Date.now() - 15 * 60000).toISOString(), userId: getName('u5', 'Sếp Phó (seppho)'), taskType: 'Auto-Tasking', tokens: 1250, status: 'Success' },
          { id: 2, timestamp: new Date(Date.now() - 45 * 60000).toISOString(), userId: getName('u3', 'Phòng Kế Toán (ketoan)'), taskType: 'Advisor', tokens: 3420, status: 'Success' },
          { id: 3, timestamp: new Date(Date.now() - 120 * 60000).toISOString(), userId: getName('u2', 'Quản lý Cơ sở 1 (manager1)'), taskType: 'Ping', tokens: 85, status: 'Success' },
          { id: 4, timestamp: new Date(Date.now() - 150 * 60000).toISOString(), userId: getName('u4', 'Phòng Marketing (marketing)'), taskType: 'Auto-Tasking', tokens: 0, status: 'Error' },
          { id: 5, timestamp: new Date(Date.now() - 200 * 60000).toISOString(), userId: getName('u1', 'Sếp Tổng (admin)'), taskType: 'Advisor', tokens: 4100, status: 'Success' }
        ];
        setLogs(mockLogs);

        const fetchViolations = async () => {
          try {
            const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/ai/violations', {
              headers: {
                'x-user-role': 'ADMIN',
                'x-facility-id': 'ALL'
              }
            });
            if (res.ok) {
              const data = await res.json();
              if (data.success && data.data) {
                setViolations(data.data.sort((a, b) => b.timestamp < a.timestamp ? -1 : 1));
                return;
              }
            }
          } catch {}
          // Fallback to local storage if API fails
          try {
            const v = JSON.parse(localStorage.getItem('taskflow_ai_violations') || '[]');
            setViolations(v.sort((a, b) => b.timestamp < a.timestamp ? -1 : 1));
          } catch {}
        };
        fetchViolations();
      }, []);

      const getMappedName = (id, fallback) => usersMap[id] || fallback;

      return (
        <div className="flex flex-col gap-6 animate-fade-in">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center dark:bg-purple-900/30 dark:text-purple-400">
                <span className="material-symbols-outlined">memory</span>
             </div>
             <div>
                <h2 className="text-xl font-bold dark:text-white">Nhật ký Hoạt động AI</h2>
                <p className="text-sm text-gray-500">Giám sát tài nguyên, băng thông API và thống kê lỗi của Trợ lý AI.</p>
             </div>
          </div>
          
          <div className="bg-white dark:bg-[#1e1e1e] border border-outline-variant dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
             <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-gray-50 dark:bg-[#252525]">
               <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                 <span className="material-symbols-outlined text-[18px]">table_chart</span> Data Table (Metadata Only)
               </h3>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-sm text-left">
                 <thead className="bg-gray-50 dark:bg-[#1a1a1a] text-gray-500 font-bold border-b border-gray-200 dark:border-gray-700">
                   <tr>
                     <th className="px-4 py-3">Thời gian</th>
                     <th className="px-4 py-3">Người dùng</th>
                     <th className="px-4 py-3">Loại tác vụ</th>
                     <th className="px-4 py-3 text-right">Số Token tiêu thụ</th>
                     <th className="px-4 py-3 text-center">Trạng thái</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                   {logs.map(log => (
                     <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                       <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                         {new Date(log.timestamp).toLocaleString('vi-VN')}
                       </td>
                       <td className="px-4 py-3 font-bold text-gray-700 dark:text-gray-200">{log.userId}</td>
                       <td className="px-4 py-3">
                         <span className={`px-2 py-1 rounded text-xs font-bold ${log.taskType === 'Auto-Tasking' ? 'bg-blue-100 text-blue-600' : log.taskType === 'Advisor' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                           {log.taskType}
                         </span>
                       </td>
                       <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">{log.tokens.toLocaleString()}</td>
                       <td className="px-4 py-3 text-center">
                         {log.status === 'Success' ? (
                           <span className="inline-flex items-center gap-1 text-green-600 bg-green-100 px-2 py-0.5 rounded-full text-xs font-bold">
                             <span className="material-symbols-outlined text-[14px]">check_circle</span> OK
                           </span>
                         ) : (
                           <span className="inline-flex items-center gap-1 text-red-600 bg-red-100 px-2 py-0.5 rounded-full text-xs font-bold">
                             <span className="material-symbols-outlined text-[14px]">error</span> Lỗi
                           </span>
                         )}
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
          </div>

          {/* Cảnh báo vi phạm */}
          <div className="bg-white dark:bg-[#1e1e1e] border border-red-200 dark:border-red-900/50 rounded-2xl shadow-sm overflow-hidden mt-2">
             <div className="p-4 border-b border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10">
               <h3 className="font-bold text-red-800 dark:text-red-400 flex items-center gap-2">
                 <span className="material-symbols-outlined text-[18px]">warning</span> Báo cáo Vi phạm Nội quy Truy vấn
               </h3>
             </div>
             <div className="p-4">
                {violations.length === 0 ? (
                  <p className="text-sm text-gray-500">Chưa ghi nhận vi phạm truy cập trái phép nào.</p>
                ) : (
                  <ul className="space-y-3">
                    {violations.map(v => (
                       <li key={v.id} className="p-4 bg-red-50/50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-xl">
                          <div className="flex justify-between items-start mb-3 border-b border-red-100 dark:border-red-900/50 pb-2">
                             <div className="flex flex-col gap-1">
                                <span className="font-bold text-sm text-red-800 dark:text-red-300 flex items-center gap-2">
                                  <span className="material-symbols-outlined text-[16px]">account_circle</span>
                                  {getMappedName(v.userId, v.userId)}
                                </span>
                                <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 px-2 py-0.5 rounded w-fit">
                                  Cơ sở: {v.facility || 'Unknown'}
                                </span>
                             </div>
                             <div className="text-xs font-mono text-red-500 dark:text-red-400 bg-white dark:bg-[#1a1a1a] px-2 py-1 rounded shadow-sm border border-red-100 dark:border-red-900/30">
                                {new Date(v.timestamp).toLocaleString('vi-VN')}
                             </div>
                          </div>
                          <div className="text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-[#1e1e1e] p-3 rounded-lg border border-red-100 dark:border-red-900/30 shadow-inner">
                             <span className="font-bold text-red-500 mr-2">Truy vấn trái phép:</span> 
                             <span className="italic">"{v.query}"</span>
                          </div>
                       </li>
                    ))}
                  </ul>
                )}
             </div>
          </div>

        </div>
      );
    }
