import React from 'react';

export default function HeatmapKPI({ user, facilityList, selectedMonth, refreshToggle }) {
       const [dailyData, setDailyData] = React.useState({});
       const [weeklyData, setWeeklyData] = React.useState([]);
       const [expandedWeeks, setExpandedWeeks] = React.useState({ 1: true, 2: true, 3: true, 4: true, 5: true });
       const [loading, setLoading] = React.useState(true);
       const [kpiTrigger, setKpiTrigger] = React.useState(0);
       
       React.useEffect(() => {
          const handler = () => setKpiTrigger(prev => prev + 1);
          window.addEventListener('taskflow_kpis_updated', handler);
          return () => window.removeEventListener('taskflow_kpis_updated', handler);
       }, []);
       
       const [yearStr, monthStr] = selectedMonth.split('-');
       const formattedMonthStr = `${monthStr}/${yearStr}`;

       React.useEffect(() => {
          setLoading(true);
          const loadData = async () => {
             try {
                const token = localStorage.getItem('taskflow_token');
                const { fetchReports } = await import('../services/dataService.js');
                const allReports = await fetchReports(token, user?.role, user?.facility_id) || [];
                
                const year = parseInt(yearStr, 10);
                const month = parseInt(monthStr, 10) - 1;
                
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                
                const defaultFacs = facilityList.length > 0 ? facilityList : Array.from({length: 6}, (_, i) => ({id: `f${i+1}`, name: `Cơ sở ${i+1}`}));
                
                const matrix = {};
                for (let i = 1; i <= daysInMonth; i++) {
                   matrix[i] = {};
                   defaultFacs.forEach(f => { matrix[i][f.name] = 0; });
                }
                
                allReports.forEach(r => {
                   if (!r.date) return;
                   const parts = r.date.split('-');
                   const rYear = parseInt(parts[0], 10);
                   const rMonth = parseInt(parts[1], 10) - 1;
                   const rDay = parseInt(parts[2], 10);
                   
                   if (rYear === year && rMonth === month && matrix[rDay]) {
                      const rData = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                      if (rData && Array.isArray(rData)) {
                         rData.forEach(facData => {
                            if (matrix[rDay][facData.name] !== undefined) {
                               matrix[rDay][facData.name] += Number(facData.revenue || 0);
                            }
                         });
                      }
                   }
                });

                const weeks = [
                   { id: 1, label: 'TUẦN 1 (01-07)', start: 1, end: 7, sums: {} },
                   { id: 2, label: 'TUẦN 2 (08-14)', start: 8, end: 14, sums: {} },
                   { id: 3, label: 'TUẦN 3 (15-21)', start: 15, end: 21, sums: {} },
                   { id: 4, label: 'TUẦN 4 (22-28)', start: 22, end: 28, sums: {} }
                ];
                if (daysInMonth > 28) {
                   const endDay = daysInMonth;
                   let rangeLabel = `29-30`;
                   if (endDay === 31) rangeLabel = `29-30-31`;
                   if (endDay === 29) rangeLabel = `29`;
                   weeks.push({ id: 5, label: `TUẦN 5 (${rangeLabel})`, start: 29, end: daysInMonth, sums: {} });
                }
                
                weeks.forEach(w => {
                    defaultFacs.forEach(f => {
                       w.sums[f.name] = 0;
                       for (let i = w.start; i <= w.end; i++) {
                          w.sums[f.name] += matrix[i][f.name];
                       }
                    });
                });

                setDailyData(matrix);
                setWeeklyData(weeks);
                setLoading(false);
             } catch (e) {
                console.error(e);
                setLoading(false);
             }
          };
          loadData();
       }, [facilityList, selectedMonth, refreshToggle, user, yearStr, monthStr]);

       const getTarget = (facName, isWeekend) => {
          let kpiStr = localStorage.getItem('taskflow_facility_kpis');
          let savedKpis = {};
          if (kpiStr) {
             let depth = 0;
             let parsed = kpiStr;
             while (typeof parsed === 'string' && depth < 5) {
                try {
                   parsed = JSON.parse(parsed);
                   depth++;
                } catch(e) {
                   break;
                }
             }
             if (typeof parsed === 'object' && parsed !== null) {
                savedKpis = parsed;
             }
          }

          const facilityKpi = Object.values(savedKpis).find(k => k?.name?.trim().toLowerCase() === facName?.trim().toLowerCase());
          
          if (facilityKpi) {
             return isWeekend ? Number(facilityKpi.weekend_target || 8000000) : Number(facilityKpi.weekday_target || 5000000);
          }
          return isWeekend ? 8000000 : 5000000;
       };

       const defaultFacs = facilityList.length > 0 ? facilityList : Array.from({length: 6}, (_, i) => ({id: `f${i+1}`, name: `Cơ sở ${i+1}`}));
       const isAllowedAll = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role);
       const allowedFacs = Array.isArray(user.facility_id) ? user.facility_id : [user.facility_id];
       const hasAll = allowedFacs.includes('ALL');

       const visibleFacs = defaultFacs.filter(f => isAllowedAll || hasAll || allowedFacs.includes(f.id) || allowedFacs.includes(f.name));

       if (loading) {
         return (
           <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm shrink-0 mt-2 h-64 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
           </div>
         );
       }

       return (
          <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm shrink-0 mt-2 flex flex-col">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 shrink-0">
                  <span className="material-symbols-outlined text-teal-600">grid_on</span>
                  Heatmap KPI Doanh Thu (Tháng {formattedMonthStr})
                </h3>
                <div className="flex gap-4 text-xs font-medium">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-800 inline-block rounded"></span> Đạt KPI</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 inline-block rounded"></span> Dưới KPI</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-700 inline-block rounded"></span> Chưa có số</span>
                </div>
             </div>
             
             <div className="overflow-auto custom-scrollbar relative max-h-[500px] border border-gray-200 dark:border-gray-700 rounded-lg">
                <table className="w-full text-sm text-center border-collapse min-w-[800px]">
                   <thead className="bg-gray-100 dark:bg-[#252525] sticky top-0 z-20 shadow-sm">
                     <tr>
                       <th className="px-4 py-3 border border-gray-200 dark:border-gray-700 font-bold sticky left-0 bg-gray-100 dark:bg-[#252525] z-30 min-w-[120px]">
                         Ngày
                       </th>
                       {visibleFacs.map(fac => (
                         <th key={fac.name} className="px-4 py-3 border border-gray-200 dark:border-gray-700 font-bold">
                           {fac.name}
                         </th>
                       ))}
                     </tr>
                   </thead>
                   <tbody>
                     {weeklyData.map(week => (
                        <React.Fragment key={`week-${week.id}`}>
                           <tr onClick={() => setExpandedWeeks(prev => ({...prev, [week.id]: !prev[week.id]}))} className="cursor-pointer bg-orange-500 hover:bg-orange-600 dark:bg-[#d95d1e] dark:hover:bg-[#c24f15] text-white transition-colors group select-none">
                              <td className="px-4 py-3 border border-orange-600 dark:border-orange-800 font-bold sticky left-0 z-10 bg-orange-500 group-hover:bg-orange-600 dark:bg-[#d95d1e] dark:group-hover:bg-[#c24f15] whitespace-nowrap text-left transition-colors">
                                 <div className="flex items-center justify-between">
                                    <span>{week.label}</span>
                                    <span className="material-symbols-outlined text-[18px]">{expandedWeeks[week.id] ? 'expand_less' : 'expand_more'}</span>
                                 </div>
                              </td>
                              {visibleFacs.map(fac => (
                                 <td key={`week-sum-${fac.name}`} className="px-4 py-3 border border-orange-600 dark:border-orange-800 font-bold">
                                     {week.sums[fac.name] > 0 ? new Intl.NumberFormat('vi-VN').format(week.sums[fac.name]) : '-'}
                                 </td>
                              ))}
                           </tr>
                           {expandedWeeks[week.id] && Array.from({length: week.end - week.start + 1}, (_, i) => week.start + i).map(d => {
                              const dateObj = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, d);
                              const dayOfWeek = dateObj.getDay(); 
                              const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; 
                              const dayLabel = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dayOfWeek];
                              
                              return (
                                <tr key={d}>
                                  <td className={`px-4 py-2 border border-gray-200 dark:border-gray-700 font-medium sticky left-0 z-10 whitespace-nowrap ${isWeekend ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400' : 'bg-gray-50 dark:bg-[#1a1a1a]'}`}>
                                    {d}/{monthStr} ({dayLabel})
                                  </td>
                                  {visibleFacs.map(fac => {
                                     const rev = Number(dailyData[d][fac.name] || 0);
                                     const target = getTarget(fac.name, isWeekend);
                                     const isMet = rev >= target;
                                     const hasData = rev > 0;
                                     
                                     let bgColorClass = 'bg-white dark:bg-[#1e1e1e] text-gray-400';
                                     if (hasData) {
                                        bgColorClass = isMet ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 font-bold' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400';
                                     }

                                     return (
                                       <td key={fac.name} className={`px-4 py-2 border border-gray-200 dark:border-gray-700 transition-colors ${bgColorClass}`}>
                                          <div className="flex flex-col items-center group relative cursor-pointer">
                                             <span>{hasData ? new Intl.NumberFormat('vi-VN').format(rev) : '-'}</span>
                                             {hasData && (
                                                <div className="absolute bottom-full mb-2 bg-gray-900 text-white text-[11px] px-3 py-2 rounded opacity-0 group-hover:opacity-100 transition-opacity z-40 whitespace-nowrap pointer-events-none shadow-lg">
                                                   <strong>{fac.name} - Ngày {d}</strong><br/>
                                                   Target KPI: {new Intl.NumberFormat('vi-VN').format(target)}<br/>
                                                   Thực tế: {new Intl.NumberFormat('vi-VN').format(rev)}<br/>
                                                   <span className={isMet ? 'text-green-400' : 'text-red-400'}>
                                                     {isMet ? '✅ Vượt chỉ tiêu' : `🔴 Chưa đạt (${new Intl.NumberFormat('vi-VN').format(rev)} < ${new Intl.NumberFormat('vi-VN').format(target)})`}
                                                   </span>
                                                </div>
                                             )}
                                          </div>
                                       </td>
                                     );
                                  })}
                                </tr>
                              );
                           })}
                        </React.Fragment>
                     ))}
                   </tbody>
                </table>
             </div>
          </div>
       );
    }
