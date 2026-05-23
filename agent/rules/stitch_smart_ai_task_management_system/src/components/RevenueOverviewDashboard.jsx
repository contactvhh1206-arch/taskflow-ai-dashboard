import React, { useState, useEffect, useRef } from 'react';

export default function RevenueOverviewDashboard({ user, facilityList }) {
      const [selectedMonth, setSelectedMonth] = React.useState(new Date().toISOString().substring(0, 7));
      const [data, setData] = React.useState([]);
      const [loading, setLoading] = React.useState(true);
      const [refreshToggle, setRefreshToggle] = React.useState(0);
      
      const [aiLoading, setAiLoading] = React.useState(false);
      const [aiError, setAiError] = React.useState('');
      const [batchData, setBatchData] = React.useState(null);
      const fileInputRef = React.useRef(null);

      const handleAIExtractClick = () => {
         fileInputRef.current?.click();
      };

      const processAIExtract = async (e) => {
         const file = e.target.files?.[0];
         if (!file) return;
         
         setAiLoading(true);
         setAiError('');
         try {
            const isImage = file.type.startsWith('image/');
            let contentData = '';

            if (isImage) {
               contentData = await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(file);
               });
               const response = await fetch('https://taskflow-ai-dashboard.onrender.com/api/internal/extract-revenue', {
                  method: 'POST',
                  headers: {
                     'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ imageBase64: contentData })
               });
               
               if (!response.ok) throw new Error("API Request Failed");
               const responseJson = await response.json();
               
               if (responseJson.success) {
                  // Normalize dates returned by AI from DD/MM/YYYY to YYYY-MM-DD
                  const normalizedData = responseJson.data.map(item => {
                     let d = item.date;
                     if (d && d.includes('/')) {
                        const parts = d.split('/');
                        if (parts.length === 3) {
                           d = `${parts[2].length === 2 ? '20'+parts[2] : parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                        }
                     }
                     return { ...item, date: d };
                  });
                  setBatchData(normalizedData);
               } else {
                  throw new Error(responseJson.error || "Lỗi xử lý AI từ máy chủ.");
               }
               
            } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.csv')) {
               const rawJsonData = await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onload = (e) => {
                     const data = new Uint8Array(e.target.result);
                     const workbook = window.XLSX.read(data, {type: 'array'});
                     const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                     const jsonData = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });
                     // Limit to first 100 rows to save tokens and time
                     resolve(jsonData.slice(0, 100));
                  };
                  reader.readAsArrayBuffer(file);
               });
               
               // DYNAMIC PROMPT INJECTION
               const facNames = facilityList.map(f => f.name).join(', ');
               const systemPrompt = `Bạn là trợ lý kế toán. Hãy quét file Excel được cung cấp và bóc tách số liệu doanh thu. Hãy KHỚP CHÍNH XÁC số liệu vào các chi nhánh hiện có sau đây của hệ thống: [${facNames}]. Tuyệt đối không tự bịa ra tên chi nhánh khác. Trả về đúng định dạng JSON: { "data": [ { "date": "YYYY-MM-DD", "revenues": { "TenChiNhanh": SỐ_TIỀN_INT } } ] }`;
               
               const aiConfigStr = localStorage.getItem('taskflow_ai_config');
               const aiConfig = aiConfigStr ? JSON.parse(aiConfigStr) : null;
               
               if (!aiConfig || !aiConfig.apiKey) {
                  throw new Error("Hệ thống yêu cầu API Key. Vui lòng cấu hình tại Cài đặt Hệ thống.");
               }
               
               const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                     'Authorization': `Bearer ${aiConfig.apiKey}`,
                     'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                     model: aiConfig.aiModel,
                     messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: JSON.stringify(rawJsonData) }
                     ],
                     response_format: { type: 'json_object' }
                  })
               });
               
               if (!response.ok) {
                  throw new Error(`API AI phản hồi lỗi: ${response.status}`);
               }
               
               const responseJson = await response.json();
               if (responseJson.usage) {
                  fetch('https://taskflow-ai-dashboard.onrender.com/api/internal/log-tokens', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-user-role': user?.role || '',
                      'x-facility-id': user?.facility_id || ''
                    },
                    body: JSON.stringify({
                      username: user?.name || user?.username || 'unknown',
                      prompt_tokens: responseJson.usage.prompt_tokens || 0,
                      completion_tokens: responseJson.usage.completion_tokens || 0,
                      total_tokens: responseJson.usage.total_tokens || 0
                    })
                  }).catch(e => console.error("Lỗi log token:", e));
               }
               let content = responseJson.choices[0].message.content;
               
               let parsedAiData = [];
               try {
                  if (content.startsWith('```json')) content = content.replace(/```json/g, '').replace(/```/g, '').trim();
                  else if (content.startsWith('```')) content = content.replace(/```/g, '').trim();
                  
                  const obj = JSON.parse(content);
                  parsedAiData = obj.data || obj;
                  if (!Array.isArray(parsedAiData)) parsedAiData = [parsedAiData];
               } catch(e) {
                  throw new Error("AI trả về sai format JSON.");
               }
               
               setBatchData(parsedAiData);
            }
         } catch (err) {
            console.error("OpenRouter API Error:", err.message || err);
            setAiError('Lỗi kết nối AI. Vui lòng kiểm tra lại API Key hoặc thử lại sau.');
         } finally {
            setAiLoading(false);
            if(fileInputRef.current) fileInputRef.current.value = '';
         }
      };

      const handleBatchUpsert = (data) => {
         const allReports = JSON.parse(localStorage.getItem('taskflow_daily_financial_reports') || '[]');
         
         // Bước 1: Lấy mảng tất cả các report_date có trong payload gửi lên
         const datesToDelete = data.map(row => row.date);
         
         // Xóa sạch dữ liệu cũ của những ngày đó để dọn đường (DELETE WHERE IN)
         const newReports = allReports.filter(r => !datesToDelete.includes(r.date));
         
         // Bước 2: Chạy lệnh BULK INSERT toàn bộ mảng data mới
         data.forEach(row => {
            const dateStr = row.date;
            const revData = facilityList.map(f => {
               const facNameShort = f.name.replace('DUBAI ', '');
               return {
                  id: f.id,
                  name: f.name,
                  revenue: row.revenues[f.name] || row.revenues[facNameShort] || 0,
                  note: 'AI Auto Extracted'
               };
            });
            const totalRev = revData.reduce((acc, curr) => acc + Number(curr.revenue), 0);
            
            newReports.push({
               id: 'rep_' + Date.now() + Math.random().toString(36).substr(2, 5),
               date: dateStr,
               createdBy: 'Finance Dept (AI)',
               timestamp: Date.now(),
               totalRevenue: totalRev,
               data: revData
            });
         });
         
         localStorage.setItem('taskflow_daily_financial_reports', JSON.stringify(newReports));
         setBatchData(null);
         alert(`Đã lưu thành công ${data.length} báo cáo!`);
         setRefreshToggle(prev => prev + 1);
      };

      React.useEffect(() => {
        setLoading(true);
        setTimeout(() => {
             const allReports = JSON.parse(localStorage.getItem('taskflow_daily_financial_reports') || '[]');
             
             const [yearStr, monthStr] = selectedMonth.split('-');
             const year = parseInt(yearStr, 10);
             const month = parseInt(monthStr, 10) - 1;
             
             const start = new Date(year, month, 1); start.setHours(0,0,0,0);
             const end = new Date(year, month + 1, 0); end.setHours(23,59,59,999);

             const timeFiltered = allReports.filter(r => {
                const rParts = r.date.split('-');
                const rDate = new Date(rParts[0], rParts[1]-1, rParts[2]);
                return rDate >= start && rDate <= end;
             });

             const isAllowedAll = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role);
             const allowedFacs = Array.isArray(user.facility_id) ? user.facility_id : [user.facility_id];
             const hasAll = allowedFacs.includes('ALL');

             const aggregated = {};
             const defaultFacs = facilityList.length > 0 ? facilityList : Array.from({length: 6}, (_, i) => ({id: `f${i+1}`, name: `Cơ sở ${i+1}`}));
             
             defaultFacs.forEach(f => {
                if (isAllowedAll || hasAll || allowedFacs.includes(f.id) || allowedFacs.includes(f.name)) {
                   aggregated[f.name] = { id: f.id, name: f.name, revenue: 0, is_active: f.is_active !== false };
                }
             });

             timeFiltered.forEach(report => {
                if (report.data && Array.isArray(report.data)) {
                   report.data.forEach(facData => {
                      if (aggregated[facData.name]) {
                         const rev = Number(facData.revenue || 0);
                         aggregated[facData.name].revenue += rev;
                      }
                   });
                }
             });

             const finalData = Object.values(aggregated).filter(f => f.is_active || f.revenue > 0);
             setData(finalData);
             setLoading(false);
        }, 400);
      }, [selectedMonth, user.role, user.facility_id, facilityList]);

      const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
      const formatCurrencyShort = (value) => {
         if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(1) + ' Tỷ';
         if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + ' Tr';
         return new Intl.NumberFormat('vi-VN').format(value);
      };

      return (
         <div className="flex flex-col gap-6 p-6 overflow-y-auto custom-scrollbar h-[calc(100vh-120px)] animate-fade-in bg-gray-50 dark:bg-[#121212]">
           {/* Header & Filter */}
           <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#1e1e1e] p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm shrink-0">
             <div>
               <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                 <span className="material-symbols-outlined text-teal-600">pie_chart</span> Tổng Quan Doanh Thu
               </h2>
               <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                 Thống kê chi tiết tài chính đa cơ sở
               </p>
             </div>
             <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-3">
                   {user.role === 'FINANCE_DEPT' && (
                     <>
                        <input type="file" accept=".png,.jpg,.jpeg,.xlsx,.csv" className="hidden" ref={fileInputRef} onChange={processAIExtract} />
                        <button onClick={handleAIExtractClick} className="px-4 py-2 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-400 rounded-lg text-sm font-bold transition flex items-center gap-2 border border-purple-200 dark:border-purple-800">
                          <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                          Tự động trích xuất bằng AI
                        </button>
                     </>
                   )}
                   <label className="text-sm font-bold text-gray-700 dark:text-gray-300 ml-2">Tháng tra cứu:</label>
                   <input 
                      type="month"
                      value={selectedMonth} 
                      onChange={e => setSelectedMonth(e.target.value)}
                      className="bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 outline-none focus:border-teal-500 text-sm font-medium dark:text-white cursor-pointer hover:border-teal-400 transition-colors"
                   />
                </div>
                {aiError && <div className="text-red-500 text-xs text-right mt-1 font-medium">{aiError}</div>}
             </div>
           </div>

           <HeatmapKPI user={user} facilityList={data} selectedMonth={selectedMonth} refreshToggle={refreshToggle} />

           {/* Cards */}
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 shrink-0 pb-6">
             {loading ? Array.from({length: 6}).map((_, i) => (
               <div key={i} className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 p-6 h-36 animate-pulse flex flex-col justify-between shadow-sm">
                 <div className="w-1/2 h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                 <div className="space-y-3 mt-4">
                   <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
                   <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
                 </div>
               </div>
             )) : data.map(fac => (
               <div key={fac.name} className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm hover:shadow-md transition-shadow group flex flex-col items-center justify-center text-center h-36">
                 <h4 className="font-bold text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2 mb-2 uppercase text-sm tracking-wide">
                   <span className="w-2 h-2 rounded-full bg-teal-500 group-hover:scale-125 transition-transform"></span> {fac.name}
                 </h4>
                 <div className="text-2xl font-black text-teal-600 dark:text-teal-400">
                   {new Intl.NumberFormat('vi-VN').format(fac.revenue)} đ
                 </div>
               </div>
             ))}
           </div>
           
           {aiLoading && (
             <div className="fixed inset-0 z-[100] bg-white/80 dark:bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
               <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
               <p className="mt-4 text-purple-700 dark:text-purple-400 font-bold text-lg animate-pulse">AI đang phân tích số liệu...</p>
             </div>
           )}
           {batchData && (
             <AIBatchPreviewModal data={batchData} facilities={facilityList} onCancel={() => setBatchData(null)} onConfirm={handleBatchUpsert} />
           )}
         </div>
      );
    }

    function KPISettings({ user, facilityList, showToast, refreshFacilities }) {
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

    function RevenueLogDashboard({ user, facilityList, showToast }) {
      const [reports, setReports] = React.useState([]);
      const [editingReport, setEditingReport] = React.useState(null);

      React.useEffect(() => {
        const stored = JSON.parse(localStorage.getItem('taskflow_daily_financial_reports') || '[]');
        stored.sort((a, b) => b.timestamp - a.timestamp);
        setReports(stored);
      }, []);

      const handleSaveEdit = (revenueData, reportDate, editReason) => {
        const totalRev = revenueData.reduce((acc, f) => acc + Number(f.revenue || 0), 0);
        
        const updatedReports = reports.map(r => {
          if (r.timestamp === editingReport.timestamp) {
             const history = r.edit_history || [];
             history.push({
               timestamp: Date.now(),
               editedBy: user.name,
               reason: editReason,
               oldTotalRevenue: r.totalRevenue,
               oldData: r.data
             });
             return {
               ...r,
               data: revenueData,
               totalRevenue: totalRev,
               edit_history: history
             };
          }
          return r;
        });

        localStorage.setItem('taskflow_daily_financial_reports', JSON.stringify(updatedReports));
        setReports(updatedReports);
        setEditingReport(null);
        showToast('✅ Đã cập nhật số liệu và lưu vết thành công!');
      };

      return (
        <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-sm border border-outline-variant dark:border-gray-800 flex flex-col overflow-hidden animate-fade-in h-[calc(100vh-120px)] relative">
          {editingReport && (
            <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
              <div className="w-full max-w-6xl h-full max-h-[90vh] bg-white dark:bg-[#121212] rounded-2xl overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col">
                <FiscalFlowModal 
                  isModal={false}
                  facilities={facilityList}
                  initialData={editingReport}
                  onBack={() => setEditingReport(null)}
                  onSave={handleSaveEdit}
                />
              </div>
            </div>
          )}

          <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-[#252525]">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">history</span> Nhật Ký Doanh Thu
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Lịch sử các báo cáo đã nộp. Kế toán có thể sửa số liệu kèm lý do.</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="py-3 text-sm font-bold text-gray-600 dark:text-gray-400">Ngày báo cáo</th>
                  <th className="py-3 text-sm font-bold text-gray-600 dark:text-gray-400 text-right">Tổng Doanh Thu</th>
                  <th className="py-3 text-sm font-bold text-gray-600 dark:text-gray-400">Người nộp</th>
                  <th className="py-3 text-sm font-bold text-gray-600 dark:text-gray-400 text-center">Lịch sử sửa</th>
                  <th className="py-3 text-sm font-bold text-gray-600 dark:text-gray-400 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {reports.length === 0 ? (
                  <tr><td colSpan="5" className="py-8 text-center text-gray-500">Chưa có dữ liệu báo cáo</td></tr>
                ) : reports.map(r => (
                  <React.Fragment key={r.timestamp}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-[#252525] group transition-colors">
                      <td className="py-4 font-medium text-gray-900 dark:text-gray-200">
                        {r.date.split('-').reverse().join('/')}
                        <div className="text-[10px] text-gray-400 font-normal">{new Date(r.timestamp).toLocaleString('vi-VN')}</div>
                      </td>
                      <td className="py-4 text-right font-bold text-gray-900 dark:text-white">
                        {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(r.totalRevenue)}
                      </td>
                      <td className="py-4 text-sm text-gray-600 dark:text-gray-300">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold">{r.createdBy.charAt(0)}</div>
                          {r.createdBy}
                        </div>
                      </td>
                      <td className="py-4 text-center">
                        {r.edit_history && r.edit_history.length > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-800" title="Đã có chỉnh sửa">
                            <span className="material-symbols-outlined text-[14px]">edit_note</span>
                            {r.edit_history.length} lần sửa
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="py-4 text-right">
                        <button onClick={() => setEditingReport(r)} className="px-4 py-1.5 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs font-medium transition shadow-sm inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">edit</span> Sửa báo cáo
                        </button>
                      </td>
                    </tr>
                    {r.edit_history && r.edit_history.length > 0 && (
                      <tr className="bg-gray-50/50 dark:bg-[#1a1a1a]/50">
                        <td colSpan="5" className="py-2 px-4 border-b border-gray-100 dark:border-gray-800">
                          <div className="pl-4 border-l-2 border-orange-300 dark:border-orange-700 space-y-2 py-2 my-1">
                            {r.edit_history.map((hist, hidx) => (
                              <div key={hidx} className="text-[11px] text-gray-600 dark:text-gray-400 flex flex-wrap gap-x-3 items-center">
                                <span className="font-medium text-orange-600 dark:text-orange-400">🕒 {new Date(hist.timestamp).toLocaleString('vi-VN')}</span>
                                <span><strong className="text-gray-900 dark:text-gray-200">{hist.editedBy}</strong> đã sửa</span>
                                <span className="bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-800 dark:text-gray-300">Lý do: {hist.reason}</span>
                                <span className="opacity-70">(Doanh thu cũ: {new Intl.NumberFormat('vi-VN').format(hist.oldTotalRevenue)})</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    function ArchivedFacilitiesDashboard({ facilityList, showToast, refreshFacilities }) {
       const archivedFacs = facilityList.filter(f => f.is_active === false);

       const handleRestore = async (fac) => {
          try {
             const res = await fetch(`http://localhost:5001/api/facilities/${fac.id}/restore`, { method: 'PUT' });
             const data = await res.json();
             if (data.success) {
                showToast('✅ Đã khôi phục cơ sở thành công!');
                if (refreshFacilities) refreshFacilities();
             }
          } catch(err) {
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

    function MainDashboard() {
      const { user, logout } = useContext(AuthContext);
      const [viewMode, setViewMode] = useState('kanban');
      const [darkMode, setDarkMode] = useState(false);
      const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
      const [activeTab, setActiveTab] = useState(() => {
        let tab = localStorage.getItem('taskflow_default_tab');
        if (!tab) {
           tab = user?.role === 'FINANCE_DEPT' ? 'revenue-overview' :
                 user?.role === 'FACILITY_MANAGER' ? 'dashboard' :
                 ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user?.role) ? 'reports' :
                 user?.role === 'ADMIN' ? 'admin' : 'tasks';
        }
        // Route Guard for FINANCE_DEPT at state initialization
        if (user?.role === 'FINANCE_DEPT' && ['dashboard', 'tasks'].includes(tab)) {
           return 'revenue-overview';
        }
        if (user?.role === 'ADMIN' && ['revenue-overview', 'kpi-settings', 'revenue-log', 'dashboard', 'tasks', 'internal-tasks'].includes(tab)) {
           return 'admin';
        }
        if (['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user?.role) && ['archives', 'admin', 'api_config'].includes(tab)) {
           return 'reports';
        }
        return tab;
      });

      useEffect(() => {
         // Route Guard hook to prevent access to forbidden tabs
         if (user?.role === 'FINANCE_DEPT' && ['tasks'].includes(activeTab)) {
            setActiveTab('revenue-overview');
         } else if (user?.role === 'ADMIN' && ['revenue-overview', 'kpi-settings', 'revenue-log', 'dashboard', 'tasks', 'internal-tasks'].includes(activeTab)) {
            setActiveTab('admin');
         } else if (['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user?.role) && ['archives', 'admin', 'api_config'].includes(activeTab)) {
            setActiveTab('reports');
         } else {
            localStorage.setItem('taskflow_default_tab', activeTab);
         }
      }, [activeTab, user?.role]);
      const loadState = (key, defaultVal) => {
        try {
          const val = localStorage.getItem(key);
          return val ? JSON.parse(val) : defaultVal;
        } catch (e) {
          return defaultVal;
        }
      };

      const [tasks, setTasks] = useState(() => {
        const defaultTasks = user && user.role === 'FACILITY_MANAGER' ? INITIAL_TASKS.filter(t => t.facility === user.facility_id || t.facilityId === user.facility_id) : INITIAL_TASKS;
        return loadState('stitch_tasks', defaultTasks);
      });
      const [taskComments, setTaskComments] = useState(() => loadState('stitch_comments', {}));

      const [aiSessions, setAiSessions] = useState(() => {
         try { return JSON.parse(localStorage.getItem('taskflow_ai_sessions') || '[]'); } catch { return []; }
      });
      const [activeAiSessionId, setActiveAiSessionId] = useState(null);

      useEffect(() => {
        localStorage.setItem('stitch_tasks', JSON.stringify(tasks));
      }, [tasks]);

      useEffect(() => {
          const handleTasksUpdated = () => {
             const allTasks = JSON.parse(localStorage.getItem('stitch_tasks') || '[]');
             setTasks(allTasks);
          };
          window.addEventListener('taskflow_tasks_updated', handleTasksUpdated);
          return () => window.removeEventListener('taskflow_tasks_updated', handleTasksUpdated);
      }, []);

      useEffect(() => {
        localStorage.setItem('stitch_comments', JSON.stringify(taskComments));
      }, [taskComments]);

      useEffect(() => {
        console.log("🛠️ [SYSTEM DEMO MODE]: Hệ thống đang chạy trên LocalStorage (Giới hạn ~5MB) để phục vụ UI/UX Demo. Dữ liệu được lưu trữ cục bộ trên trình duyệt này.");
        console.log("🔌 [ROADMAP INTEGRATION]: Hạ tầng Websocket Event Listener đã sẵn sàng (Phase 2).");
        const mockSocket = { on: (event, cb) => { } };
        mockSocket.on('task_updated', (updatedTask) => { });
      }, []);

      const triggerWebhookAlert = (eventData) => {
        const payload = { timestamp: new Date().toISOString(), app_source: 'STITCH_SMART_AI_KANBAN', ...eventData };
        console.log(`%c[WEBHOOK TRIGGERED] ${payload.action}`, 'background: #222; color: #bada55; font-size: 14px; font-weight: bold;', payload);
      };

      const [globalFacilityFilter, setGlobalFacilityFilter] = useState(() => {
         if (user.role === 'FACILITY_MANAGER') {
            if (Array.isArray(user.facility_id) && user.facility_id.length > 0) return user.facility_id[0];
            return user.facility_id || user.username || 'ALL';
         }
         return 'ALL';
      });
      const [archiveSearch, setArchiveSearch] = useState('');
      const [archiveDateFrom, setArchiveDateFrom] = useState('');
      const [archiveDateTo, setArchiveDateTo] = useState('');
      const [archivePic, setArchivePic] = useState('');
      const [commentText, setCommentText] = useState('');
      const [showAIDrawer, setShowAIDrawer] = useState(false);

      const handleDropTask = (taskId, newStatus) => {
        if (newStatus === 'done' && user.role === 'DEPARTMENT_HEAD' && activeTab !== 'internal-tasks') {
          showToast('❌ Trưởng phòng chỉ có quyền giám sát, không được thao tác nghiệm thu');
          return;
        }
        if (newStatus === 'done' && user.role === 'VICE_PRESIDENT' && activeTab !== 'internal-tasks') {
          showToast('❌ Sếp Phó không được phép đóng công việc của cấp dưới');
          return;
        }
        const todayStr = new Date().toISOString().split('T')[0];
        const statusNames = { todo: 'Cần làm', in_progress: 'Đang tiến hành', done: 'Hoàn thành' };
        const event = `Chuyển trạng thái: ${statusNames[newStatus] || newStatus}`;
        const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');

        setTasks(prev => prev.map(t => {
          if (t.id === taskId) {
            let updated = { ...t, status: newStatus };
            if (newStatus === 'done' && t.status !== 'done') {
              updated.completedAtReal = Date.now();
              updated.completedAt = todayStr;
            } else if (newStatus !== 'done') {
              updated.completedAt = null;
            }
            if (newStatus === 'in_progress' && t.status !== 'in_progress') {
              updated.inProgressAt = Date.now();
            }
            updated.historyLog = [...(t.historyLog || []), { time: now, event }];
            return updated;
          }
          return t;
        }));
      };

      const handleAddComment = () => {
        if (!commentText.trim() || !selectedTask) return;
        const nowTime = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const nowDate = new Date().toLocaleDateString('vi-VN');
        const newComment = {
          id: generateId(),
          sender: user.name,
          role: user.role,
          text: commentText,
          time: nowTime
        };
        setTaskComments(prev => ({
          ...prev,
          [selectedTask.id]: [...(prev[selectedTask.id] || []), newComment]
        }));
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, historyLog: [...(t.historyLog || []), { time: `${nowTime} - ${nowDate}`, event: `Bình luận mới từ ${user.name}` }] } : t));
        setCommentText('');
      };

      const [facilityStatuses, setFacilityStatuses] = useState([]);
      const [isCheckinCompleted, setIsCheckinCompleted] = useState(false);

      const [selectedTask, setSelectedTask] = useState(null);
      const [showAITaskModal, setShowAITaskModal] = useState(false);

      const [showCreateModal, setShowCreateModal] = useState(false);
      const [createModalStatus, setCreateModalStatus] = useState('todo');

      const [toastMessage, setToastMessage] = useState('');

      const [readNotifications, setReadNotifications] = useState(() => loadState('taskflow_read_notifications', []));
      const [showNotifications, setShowNotifications] = useState(false);

      const notifications = React.useMemo(() => {
        if (user?.role !== 'FACILITY_MANAGER') return [];
        let notifs = [];
        const myTasks = tasks.filter(t => t.facility === user.facility_id || t.facilityId === user.facility_id);
        const todayStr = new Date().toISOString().split('T')[0];
        
        myTasks.forEach(t => {
          if (t.status === 'done' || t.status === 'revoked') return;
          
          if (t.is_boss_assigned) {
            notifs.push({
              id: `boss_${t.id}`,
              type: 'boss_task',
              taskId: t.id,
              task: t,
              message: `Sếp Tổng đã giao nhiệm vụ mới: "${t.title}".`,
              timestamp: t.created_at || new Date().toISOString(),
              isRead: readNotifications.includes(`boss_${t.id}`)
            });
          }

          if (t.deadline) {
            if (t.deadline < todayStr) {
               notifs.push({
                 id: `ping_overdue_${t.id}`,
                 type: 'ai_ping',
                 taskId: t.id,
                 task: t,
                 message: `[AI Alert] Task "${t.title}" đã trễ hạn! Bạn có cần hỗ trợ điều phối nhân sự không?`,
                 timestamp: new Date().toISOString(),
                 isRead: readNotifications.includes(`ping_overdue_${t.id}`)
               });
            } else if (t.deadline === todayStr) {
               notifs.push({
                 id: `ping_due_${t.id}`,
                 type: 'ai_ping',
                 taskId: t.id,
                 task: t,
                 message: `[AI Alert] Task "${t.title}" hết hạn trong hôm nay. Cố gắng lên nhé!`,
                 timestamp: new Date().toISOString(),
                 isRead: readNotifications.includes(`ping_due_${t.id}`)
               });
            }
          }
        });
        
        const allCheckins = loadState('taskflow_checkins', []);
        const hasCheckedInToday = allCheckins.some(c => (c.username === user.username || c.userId === user.id) && c.date === todayStr);
        if (!hasCheckedInToday) {
           notifs.push({
              id: `checkin_${todayStr}`,
              type: 'checkin',
              message: `[Hệ thống] Bạn chưa thực hiện Check-in điểm danh đầu ngày. Vui lòng xác nhận quân số!`,
              timestamp: new Date().toISOString(),
              isRead: readNotifications.includes(`checkin_${todayStr}`)
           });
        }

        return notifs.sort((a, b) => (a.isRead === b.isRead ? 0 : a.isRead ? 1 : -1));
      }, [tasks, user, readNotifications]);

      const unreadCount = notifications.filter(n => !n.isRead).length;

      const handleOpenNotifications = () => {
         setShowNotifications(!showNotifications);
         if (!showNotifications && unreadCount > 0) {
            const newRead = [...new Set([...readNotifications, ...notifications.map(n => n.id)])];
            setReadNotifications(newRead);
            localStorage.setItem('taskflow_read_notifications', JSON.stringify(newRead));
         }
      };

      const handleNotificationClick = (notif) => {
         setShowNotifications(false);
         if (notif.taskId && notif.task) {
            setActiveTab('dashboard');
            setSelectedTask(notif.task);
         } else if (notif.type === 'checkin') {
            setActiveTab('checkin');
         }
      };

      // Dashboard time filter and stats
      const [timeFilter, setTimeFilter] = useState('week'); // 'week' | 'month'
      const [dashboardStats, setDashboardStats] = useState({ open: 0, completed: 0, overdue: 0 });
      const [isStatsLoading, setIsStatsLoading] = useState(false);

      const fetchDashboardStats = (filter) => {
        setIsStatsLoading(true);
        setTimeout(() => {
          const now = new Date('2026-05-15T19:42:42+07:00'); // System time as per metadata
          let start, end;
          if (filter === 'week') {
            const day = now.getDay() || 7;
            start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(now.getDate() - day + 1);
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
          } else {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            end.setHours(23, 59, 59, 999);
          }

          // RLS Policy cho Dashboard Stats
          const accessibleTasks = tasks.filter(t => {
             if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'GENERAL_MANAGER', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role)) {
                return true;
             }
             const facId = t.facilityId || t.facility;
             return facId === user.facility_id || user.facility_id === 'ALL';
          });

          let userTasks = accessibleTasks;
          if (typeof globalFacilityFilter !== 'undefined' && globalFacilityFilter !== 'ALL') {
            userTasks = accessibleTasks.filter(t => t.facility === globalFacilityFilter || t.facilityId === globalFacilityFilter);
          }
          let open = 0, completed = 0, overdue = 0;

          userTasks.forEach(t => {
            const createdAt = new Date(t.createdAt || t.deadline);
            const deadline = new Date(t.deadline);
            const isDone = t.status === 'done' || t.status === 'review';
            const compAt = t.completedAt ? new Date(t.completedAt) : null;

            if (createdAt >= start && createdAt <= end && !isDone) {
              open++;
            }
            if (isDone && compAt && compAt >= start && compAt <= end) {
              completed++;
            }
            if (deadline >= start && deadline <= end) {
              if (!isDone) {
                if (now > deadline) overdue++;
              } else if (compAt && compAt > deadline) {
                overdue++;
              }
            }
          });

          setDashboardStats({ open, completed, overdue });
          setIsStatsLoading(false);
        }, 800);
      };

      useEffect(() => {
        if (user) fetchDashboardStats(timeFilter);
      }, [user, timeFilter, tasks, globalFacilityFilter]);

      const showToast = (msg) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(''), 4000);
      };

      const handleCreateTask = (newTask) => {
        const newId = generateId();
        const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');
        let overrideFields = {};
        if (activeTab === 'internal-tasks') {
           if (user.role === 'FINANCE_DEPT') { overrideFields = { facilityId: 'Phòng Kế Toán', facility: 'Phòng Kế Toán', department_tag: 'FINANCE', pic: 'Phòng Kế Toán' }; }
           else if (user.role === 'DEPARTMENT_HEAD') { overrideFields = { facilityId: 'Phòng Marketing', facility: 'Phòng Marketing', department_tag: 'MARKETING', pic: 'Phòng Marketing' }; }
        }

        setTasks([...tasks, {
          id: newId,
          pic: user.name,
          deadline: new Date().toISOString().split('T')[0],
          urgent: false,
          facilityId: user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id,
          description: '',
          historyLog: [{ time: now, event: `Khởi tạo công việc` }],
          ...newTask,
          ...overrideFields
        }]);

        if (window.DataService) {
           let orgUnit = user?.role === 'SUPER_ADMIN' ? 'HQ' : (user?.department || user?.facility_id || 'ALL');
           if (user?.role === 'FINANCE_DEPT') orgUnit = 'FINANCE';
           if (user?.role === 'DEPARTMENT_HEAD') orgUnit = 'MARKETING';
           window.DataService.saveData({
             org_unit: orgUnit,
             entry_type: 'Operation_Log',
             content: `${user?.name} đã tạo công việc mới: ${newTask.title}`,
           });
        }
      };

      const handleAITaskConfirm = (draftTasks) => {
        if (draftTasks && draftTasks.length > 0) {
          setTasks([...tasks, ...draftTasks]);
          showToast(`Đã tạo thành công ${draftTasks.length} công việc từ biên bản.`);
        }
      };

      useEffect(() => {
        if (user) {
          fetchFacilityStatuses();
        }
      }, [user]);

      const toggleDarkMode = () => {
        setDarkMode(!darkMode);
        if (!darkMode) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      };

      const fetchFacilityStatuses = async () => {
        try {
          const response = await fetch('https://taskflow-ai-dashboard.onrender.com/api/checkin/status', { headers: { 'x-user-role': user.role, 'x-facility-id': user.facility_id || 'ALL' } });
          if (response.ok) {
            const data = await response.json();
            setFacilityStatuses(data.data);
            if (user.role === 'FACILITY_MANAGER') {
              const myFac = data.data.find(f => f.facility_id === user.facility_id);
              if (myFac && (myFac.ca1 === 'Đã báo cáo' || myFac.ca2 === 'Đã báo cáo')) {
                setIsCheckinCompleted(true);
              } else {
                setIsCheckinCompleted(false);
              }
            }
          } else {
            setFacilityStatuses([{ facility_id: 'Cơ sở 1', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }, { facility_id: 'Cơ sở 2', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }]);
            if (user.role === 'FACILITY_MANAGER') {
              setIsCheckinCompleted(false);
            }
          }
        } catch (e) {
          setFacilityStatuses([{ facility_id: 'Cơ sở 1', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }, { facility_id: 'Cơ sở 2', ca1: 'Chưa báo cáo', ca2: 'Chưa báo cáo' }]);
          if (user.role === 'FACILITY_MANAGER') {
            setIsCheckinCompleted(false);
          }
        }
      };

      const todayStr = new Date().toISOString().split('T')[0];
      // RLS Policy Evaluation (Row-Level Security)
      const accessibleTasks = tasks.filter(t => {
         if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN', 'GENERAL_MANAGER', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role)) {
            return true;
         }

         // Mặc định cho FACILITY_MANAGER và các role khác
         const facId = t.facilityId || t.facility;
         const allowedFacs = Array.isArray(user.facility_id) ? user.facility_id : [user.facility_id || user.username];
         return allowedFacs.includes('ALL') || allowedFacs.includes(facId);
      });

      const isInternalTask = (t) => {
         const deptId = user.department_id || (user.username === 'marketing' ? 'MARKETING' : (user.role === 'FINANCE_DEPT' ? 'FINANCE' : ''));
         const tTitle = (t.title || '').toLowerCase();
         return t.department_tag === deptId || t.pic === user.name || t.picId === user.username || (deptId === 'MARKETING' && (tTitle.includes('marketing') || tTitle.includes('ads') || tTitle.includes('quảng cáo') || tTitle.includes('kịch bản') || tTitle.includes('video'))) || (deptId === 'FINANCE' && (tTitle.includes('doanh thu') || tTitle.includes('kế toán') || tTitle.includes('tài chính')));
      };

      const kanbanTasks = accessibleTasks.filter(t => t.status !== 'revoked' && (t.status !== 'done' || !t.completedAt || t.completedAt === todayStr) && (activeTab === 'internal-tasks' ? isInternalTask(t) : (globalFacilityFilter === 'ALL' || t.facilityId === globalFacilityFilter || t.facility === globalFacilityFilter)));
      const archivedTasks = accessibleTasks.filter(t => t.status === 'done' || t.status === 'revoked').filter(t => {
        if (archiveSearch && !t.title.toLowerCase().includes(archiveSearch.toLowerCase())) return false;
        if (archivePic && !t.pic.toLowerCase().includes(archivePic.toLowerCase())) return false;
        if (archiveDateFrom && t.completedAt && t.completedAt < archiveDateFrom) return false;
        if (archiveDateTo && t.completedAt && t.completedAt > archiveDateTo) return false;
        if (activeTab === 'internal-tasks') {
           if (!isInternalTask(t)) return false;
        } else {
           if (globalFacilityFilter !== 'ALL' && t.facilityId !== globalFacilityFilter && t.facility !== globalFacilityFilter) return false;
        }
        return true;
      });

      const [facilityList, setFacilityList] = useState([]);

      const fetchFacilities = async () => {
         const addDynamicVPs = (facs) => {
            let updatedFacs = facs.filter(f => !f.isExecutive && f.id !== 'vp1' && f.id !== 'vp2');
            const users = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
            const vpUsers = users.filter(u => u.role === 'VICE_PRESIDENT');
            vpUsers.forEach(vp => {
               updatedFacs.push({ id: `vp_${vp.id}`, name: `Sếp ${vp.name || vp.username}`, isExecutive: true, is_active: true });
            });
            return updatedFacs;
         };
         try {
            const res = await fetch('http://localhost:5001/api/facilities');
            const json = await res.json();
            if (json.success) {
               localStorage.setItem('taskflow_facilities', JSON.stringify(json.data));
               setFacilityList(addDynamicVPs(json.data));
            }
         } catch(err) {
            let localFacs = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
            if (localFacs.some(f => f.isExecutive || f.id === 'vp1' || f.id === 'vp2')) {
               localFacs = localFacs.filter(f => !f.isExecutive && f.id !== 'vp1' && f.id !== 'vp2');
               localStorage.setItem('taskflow_facilities', JSON.stringify(localFacs));
            }
            if (localFacs.length === 0) {
               localFacs = [
                  { id: 'f1', name: 'DUBAI 41', is_active: true },
                  { id: 'f2', name: 'DUBAI ACE', is_active: true },
                  { id: 'f3', name: 'DUBAI PA', is_active: true },
                  { id: 'f4', name: 'DUBAI PAK', is_active: true },
                  { id: 'f5', name: 'DUBAI PAV', is_active: true },
                  { id: 'f6', name: 'DUBAI PHÚ QUỐC', is_active: true }
               ];
               localStorage.setItem('taskflow_facilities', JSON.stringify(localFacs));
            }
            setFacilityList(addDynamicVPs(localFacs));
         }
      };

      useEffect(() => {
         fetchFacilities();
      }, []);

      const activeFacilities = facilityList.filter(f => f.is_active !== false).filter(f => {
         if (f.isExecutive) return user?.role === 'SUPER_ADMIN' || user?.role === 'VICE_PRESIDENT';
         return true;
      });
      const archivedFacilities = facilityList.filter(f => f.is_active === false);

      return (
        <div className={`flex h-screen w-full font-sans ${darkMode ? 'dark bg-[#121212] text-white' : 'bg-surface text-on-surface'}`}>
          <aside className="w-64 bg-surface-container-low dark:bg-[#1e1e1e] border-r border-outline-variant dark:border-gray-800 flex flex-col transition-colors">
            <div className="p-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/30">
                <span className="material-symbols-outlined">hub</span>
              </div>
              <div>
                <h1 className="font-display font-bold text-lg leading-tight tracking-tight text-primary dark:text-blue-400">TaskFlow AI</h1>
                <p className="text-xs text-on-surface-variant dark:text-gray-400">Trung tâm Điều khiển</p>
              </div>
            </div>

            <nav className="flex-1 px-4 space-y-1">
              {user.role === 'FACILITY_MANAGER' && (
                <>
                  <NavItem icon="dashboard" label="Tổng quan" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
                  <NavItem icon="assignment" label="Công việc" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
                  <NavItem icon="fact_check" label="Điểm danh" active={activeTab === 'checkin'} onClick={() => setActiveTab('checkin')} />
                </>
              )}
              {user.role === 'DEPARTMENT_HEAD' && (
                <>
                  <NavItem icon="pie_chart" label="Tổng quan doanh thu" active={activeTab === 'revenue-overview'} onClick={() => setActiveTab('revenue-overview')} />
                  <NavItem icon="dashboard" label="Bảng tin công việc" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
                  <NavItem icon="content_paste" label="Công việc" active={activeTab === 'internal-tasks'} onClick={() => { setActiveTab('internal-tasks'); setGlobalFacilityFilter('ALL'); }} />
                  <NavItem icon="assignment" label="Giám sát Đa cơ sở" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
                </>
              )}
              {user.role === 'FINANCE_DEPT' && (
                <>
                  <NavItem icon="dashboard" label="Bảng tin công việc" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
                  <NavItem icon="content_paste" label="Công việc" active={activeTab === 'internal-tasks'} onClick={() => { setActiveTab('internal-tasks'); setGlobalFacilityFilter('ALL'); }} />
                  <NavItem icon="pie_chart" label="Tổng quan doanh thu" active={activeTab === 'revenue-overview'} onClick={() => setActiveTab('revenue-overview')} />
                  <NavItem icon="bar_chart" label="Báo cáo hằng ngày" active={activeTab === 'daily-report'} onClick={() => setActiveTab('daily-report')} />
                  <NavItem icon="history" label="Nhật ký doanh thu" active={activeTab === 'revenue-log'} onClick={() => setActiveTab('revenue-log')} />
                  <NavItem icon="target" label="Cài đặt KPI" active={activeTab === 'kpi-settings'} onClick={() => setActiveTab('kpi-settings')} />
                  <NavItem icon="archive" label="Dữ liệu Lưu trữ" active={activeTab === 'archives'} onClick={() => setActiveTab('archives')} />
                </>
              )}
              {['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role) && (
                <>
                  {user.role === 'VICE_PRESIDENT' && (
                    <>
                      <NavItem icon="content_paste" label="Công việc" active={activeTab === 'internal-tasks'} onClick={() => { setActiveTab('internal-tasks'); setGlobalFacilityFilter('ALL'); }} />
                    </>
                  )}
                  <NavItem icon="space_dashboard" label="Executive Dashboard" active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} />
                  <NavItem icon="corporate_fare" label="Đa cơ sở" active={activeTab === 'facilities'} onClick={() => setActiveTab('facilities')} />
                  <NavItem icon="pie_chart" label="Tổng quan doanh thu" active={activeTab === 'revenue-overview'} onClick={() => setActiveTab('revenue-overview')} />
                  <NavItem icon="target" label="Cài đặt KPI" active={activeTab === 'kpi-settings'} onClick={() => setActiveTab('kpi-settings')} />
                </>
              )}
              {user.role === 'ADMIN' && (
                <>
                  <NavItem icon="archive" label="Dữ liệu Lưu trữ" active={activeTab === 'archives'} onClick={() => setActiveTab('archives')} />
                  <NavItem icon="settings" label="Cấu hình hệ thống" active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />
                  <NavItem icon="api" label="Cấu hình API & AI" active={activeTab === 'api_config'} onClick={() => setActiveTab('api_config')} />
                  <NavItem icon="memory" label="Nhật ký Hoạt động AI" active={activeTab === 'ai_logs'} onClick={() => setActiveTab('ai_logs')} />
                  <NavItem icon="database" label="Quản lý Tri thức (RAG)" active={activeTab === 'rag_manager'} onClick={() => setActiveTab('rag_manager')} />
                  <NavItem icon="support_agent" label="AI Hỗ trợ" active={false} onClick={() => setShowAIDrawer(true)} />
                </>
              )}
              
              {['SUPER_ADMIN', 'VICE_PRESIDENT', 'GENERAL_MANAGER', 'DEPARTMENT_HEAD', 'ADMIN'].includes(user.role) && (
                 <div className="mt-6 mb-2 px-4">
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 mb-3 flex items-center justify-between tracking-widest uppercase">
                       Lịch sử trò chuyện AI
                       <button onClick={() => { setActiveAiSessionId(null); if (['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role)) { setActiveTab('reports'); } else if (['ADMIN'].includes(user.role)) { setShowAIDrawer(true); } else { setShowAITaskModal(true); } }} className="hover:text-primary transition-colors flex items-center" title="Cuộc hội thoại mới">
                          <span className="material-symbols-outlined text-[16px]">add_circle</span>
                       </button>
                    </div>
                    <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto custom-scrollbar pr-1">
                       {aiSessions.filter(s => s.userId === user.id).length === 0 ? (
                          <div className="text-xs text-gray-400 dark:text-gray-600 italic px-2">Chưa có lịch sử...</div>
                       ) : (
                          aiSessions.filter(s => s.userId === user.id).map(session => (
                             <div 
                                key={session.id} 
                                onClick={() => { 
                                   setActiveAiSessionId(session.id); 
                                   if (['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role)) {
                                      setActiveTab('reports'); 
                                   } else if (['ADMIN'].includes(user.role)) {
                                      setShowAIDrawer(true);
                                   } else {
                                      setShowAITaskModal(true);
                                   }
                                }}
                                className={`text-xs truncate px-3 py-2 rounded-lg cursor-pointer transition-colors flex items-center gap-2 ${activeAiSessionId === session.id && (activeTab === 'reports' || !['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role)) ? 'bg-primary/10 text-primary font-bold dark:bg-blue-900/30' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                             >
                                <span className="material-symbols-outlined text-[14px]">chat_bubble_outline</span>
                                {session.title}
                             </div>
                          ))
                       )}
                    </div>
                 </div>
              )}
            </nav>

            <div className="p-4 border-t border-outline-variant dark:border-gray-800 space-y-2">
              <div className="px-3 py-2 flex items-center gap-3 bg-surface dark:bg-gray-800 rounded-lg border border-outline-variant dark:border-gray-700 shadow-sm mb-4">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-semibold truncate dark:text-white">{user.name}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{user.role}</p>
                </div>
              </div>
              <button onClick={() => setShowChangePasswordModal(true)} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors mb-2">
                <span className="material-symbols-outlined">key</span> Đổi mật khẩu
              </button>
              <button onClick={logout} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error-container dark:hover:bg-red-900/30 rounded-lg transition-colors">
                <span className="material-symbols-outlined">logout</span> Đăng xuất
              </button>
            </div>
          </aside>

          <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative transition-colors">
            <header className="h-16 border-b border-outline-variant dark:border-gray-800 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10 transition-colors">
              <div className="flex items-center gap-4 flex-1">
                {activeTab !== 'reports' && !(activeTab === 'dashboard' && ['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role)) && (
                  <div className="relative w-96 hidden md:block">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">search</span>
                    <input type="text" placeholder="Tìm kiếm task, cơ sở, PIC..." className="w-full bg-surface-container dark:bg-gray-800 border-transparent focus:border-primary focus:ring-1 focus:ring-primary rounded-full pl-10 pr-4 py-2 text-sm outline-none transition-all dark:text-white" />
                  </div>
                )}
                {!['admin', 'api_config', 'internal-tasks', 'reports'].includes(activeTab) && !(['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role) && activeTab === 'dashboard') && (
                  ['SUPER_ADMIN', 'VICE_PRESIDENT', 'GENERAL_MANAGER', 'ADMIN', 'DEPARTMENT_HEAD'].includes(user.role) ? (
                    <div className="relative flex items-center bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-full shadow-sm hover:border-gray-400 dark:hover:border-gray-600 transition-colors max-w-[250px]">
                      <select
                        value={globalFacilityFilter}
                        onChange={(e) => setGlobalFacilityFilter(e.target.value)}
                        className="appearance-none flex-1 pl-4 pr-8 py-2 text-sm outline-none focus:outline-none focus:ring-0 focus:border-transparent focus:[outline:none_!important] focus:[box-shadow:none_!important] rounded-full dark:text-white font-medium bg-transparent cursor-pointer text-ellipsis overflow-hidden whitespace-nowrap"
                      >
                        <option value="ALL">🌐 Tất cả cơ sở & Phòng ban</option>
                        <optgroup label="Cơ sở dịch vụ">
                          {activeFacilities.map(f => (
                            <option key={f.id} value={f.name}>{f.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Khối Phòng ban">
                          <option value="Phòng Kế Toán">Phòng Kế Toán</option>
                          <option value="Phòng Marketing">Phòng Marketing</option>
                        </optgroup>
                      </select>
                      <span className="material-symbols-outlined absolute right-2.5 text-gray-500 pointer-events-none flex-shrink-0 text-[18px]">expand_more</span>
                    </div>
                  ) : (
                    <div className="bg-primary/10 text-primary border border-primary/20 text-sm rounded-lg px-4 py-2 font-bold shadow-sm flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">public</span>
                      {Array.isArray(user.facility_id) ? user.facility_id.join(', ') : user.facility_id}
                    </div>
                  )
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={toggleDarkMode} className="p-2 rounded-full hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-500 transition-colors">
                  <span className="material-symbols-outlined">{darkMode ? 'light_mode' : 'dark_mode'}</span>
                </button>
                {['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'].includes(user.role) && (
                  <button onClick={() => setShowAIDrawer(true)} className="p-2 rounded-full hover:bg-secondary/10 text-secondary relative transition-colors bg-secondary/5">
                    <span className="material-symbols-outlined">robot_2</span>
                    <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-secondary rounded-full border-2 border-white dark:border-[#121212] animate-ping"></span>
                    <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-secondary rounded-full border-2 border-white dark:border-[#121212]"></span>
                  </button>
                )}
                <div className="relative">
                  <button onClick={handleOpenNotifications} className="p-2 rounded-full hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-500 relative transition-colors">
                    <span className="material-symbols-outlined">notifications</span>
                    {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-error rounded-full border-2 border-white dark:border-[#121212]"></span>}
                  </button>
                  {showNotifications && (
                    <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-[60] overflow-hidden animate-fade-in">
                      <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
                        <h4 className="font-bold text-gray-800 dark:text-white">Thông báo</h4>
                        {unreadCount > 0 && <span className="text-xs bg-error/10 text-error px-2 py-0.5 rounded-full font-medium">{unreadCount} chưa đọc</span>}
                      </div>
                      <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                        {notifications.length === 0 ? (
                           <div className="p-6 text-center text-sm text-gray-500">Bạn không có thông báo nào.</div>
                        ) : (
                           notifications.map(n => (
                             <div 
                               key={n.id} 
                               onClick={() => handleNotificationClick(n)}
                               className={`p-3 border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors ${!n.isRead ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                             >
                               <div className="flex gap-3">
                                 <div className="shrink-0 mt-0.5">
                                   {n.type === 'ai_ping' ? (
                                      <div className="w-8 h-8 rounded-full bg-secondary/10 text-secondary flex items-center justify-center"><span className="material-symbols-outlined text-[16px]">robot_2</span></div>
                                   ) : n.type === 'boss_task' ? (
                                      <div className="w-8 h-8 rounded-full bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 flex items-center justify-center"><span className="material-symbols-outlined text-[16px] drop-shadow-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span></div>
                                   ) : (
                                      <div className="w-8 h-8 rounded-full bg-error/10 text-error flex items-center justify-center"><span className="material-symbols-outlined text-[16px]">alarm</span></div>
                                   )}
                                 </div>
                                 <div className="flex-1 min-w-0">
                                   <p className={`text-sm text-gray-800 dark:text-gray-200 ${!n.isRead ? 'font-bold' : ''}`}>{n.message}</p>
                                   <p className="text-[10px] text-gray-400 mt-1">{new Date(n.timestamp).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'})}</p>
                                 </div>
                                 {!n.isRead && <div className="w-2 h-2 rounded-full bg-primary shrink-0 self-center"></div>}
                               </div>
                             </div>
                           ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-6 bg-surface-container-low dark:bg-[#181818] transition-colors custom-scrollbar">
              <div className="max-w-6xl mx-auto">
                {activeTab === 'checkin' && user.role === 'FACILITY_MANAGER' ? (
                  <ErrorBoundary>
                    <DailyCheckin
                      showToast={showToast}
                      onCheckinSuccess={() => {
                        setIsCheckinCompleted(true);
                        fetchFacilityStatuses();
                        setActiveTab('tasks');
                      }}
                    />
                  </ErrorBoundary>
                ) : activeTab === 'reports' && ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role) ? (
                  <ErrorBoundary>
                    <ExecutiveDashboard 
                      user={user} 
                      tasks={tasks} 
                      activeAiSessionId={activeAiSessionId}
                      onChatUpdate={() => setAiSessions(JSON.parse(localStorage.getItem('taskflow_ai_sessions') || '[]'))}
                      onNewSession={(id) => { setActiveAiSessionId(id); setAiSessions(JSON.parse(localStorage.getItem('taskflow_ai_sessions') || '[]')); }}
                      onNavigateToFacility={(facName) => { setGlobalFacilityFilter(facName); setActiveTab('tasks'); }} 
                    />
                  </ErrorBoundary>
                ) : activeTab === 'admin' && user.role === 'ADMIN' ? (
                  <ErrorBoundary>
                    <AdminConfigPanel showToast={showToast} tasks={tasks} setTasks={setTasks} setTaskComments={setTaskComments} user={user} />
                  </ErrorBoundary>
                ) : activeTab === 'api_config' && user.role === 'ADMIN' ? (
                  <ErrorBoundary>
                    <ApiConfigPanel showToast={showToast} />
                  </ErrorBoundary>
                ) : activeTab === 'ai_logs' && user.role === 'ADMIN' ? (
                  <ErrorBoundary>
                    <AIUsageLogs />
                  </ErrorBoundary>
                ) : activeTab === 'rag_manager' && user.role === 'ADMIN' ? (
                  <ErrorBoundary>
                    <RAGManagerPanel showToast={showToast} />
                  </ErrorBoundary>
                ) : activeTab === 'dashboard' && (user.role === 'FACILITY_MANAGER' || ['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role)) ? (
                  <ErrorBoundary>
                    <FacilityDashboard user={user} tasks={tasks} onNavigate={(tab) => setActiveTab(tab)} onOpenTask={(task) => setSelectedTask(task)} globalFacilityFilter={globalFacilityFilter} />
                  </ErrorBoundary>
                ) : activeTab === 'revenue-overview' && ['SUPER_ADMIN', 'FINANCE_DEPT', 'DEPARTMENT_HEAD', 'VICE_PRESIDENT'].includes(user.role) ? (
                  <ErrorBoundary>
                    <RevenueOverviewDashboard user={user} facilityList={facilityList} />
                  </ErrorBoundary>
                ) : activeTab === 'kpi-settings' && ['SUPER_ADMIN', 'FINANCE_DEPT', 'VICE_PRESIDENT'].includes(user.role) ? (
                  <ErrorBoundary>
                    <KPISettings user={user} facilityList={activeFacilities} showToast={showToast} refreshFacilities={fetchFacilities} />
                  </ErrorBoundary>
                ) : activeTab === 'archives' && ['ADMIN', 'FINANCE_DEPT'].includes(user.role) ? (
                  <ErrorBoundary>
                    <ArchivedFacilitiesDashboard facilityList={facilityList} showToast={showToast} refreshFacilities={fetchFacilities} />
                  </ErrorBoundary>
                ) : activeTab === 'daily-report' && user.role === 'FINANCE_DEPT' ? (
                  <ErrorBoundary>
                    <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-sm border border-outline-variant dark:border-gray-800 p-6">
                       <FiscalFlowModal 
                          isModal={false}
                          facilities={activeFacilities.length > 0 ? activeFacilities : [{id: 'f1', name: 'Cơ sở 1'}, {id: 'f2', name: 'Cơ sở 2'}, {id: 'f3', name: 'Cơ sở 3'}, {id: 'f4', name: 'Cơ sở 4'}, {id: 'f5', name: 'Cơ sở 5'}, {id: 'f6', name: 'Cơ sở 6'}]} 
                          onSave={(revenueData, reportDate) => {
                             const totalRev = revenueData.reduce((acc, f) => acc + Number(f.revenue || 0), 0);
                             const existingReports = JSON.parse(localStorage.getItem('taskflow_daily_financial_reports') || '[]');
                             existingReports.push({ date: reportDate, data: revenueData, totalRevenue: totalRev, createdBy: user.name, timestamp: Date.now() });
                             localStorage.setItem('taskflow_daily_financial_reports', JSON.stringify(existingReports));
                             const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');
                             const newTask = {
                                id: Date.now(),
                                title: `Đã nộp báo cáo doanh thu ngày ${reportDate.split('-').reverse().join('/')}`,
                                desc: `Tổng doanh thu hệ thống: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalRev)}`,
                                pic: user.name,
                                facility: 'ALL',
                                facilityId: 'ALL',
                                deadline: reportDate,
                                status: 'done',
                                urgent: false,
                                completedAt: reportDate,
                                completedAtReal: Date.now(),
                                department_tag: 'FINANCE',
                                revenueData: revenueData,
                                custom_metadata: JSON.stringify({ revenueData, reportDate }),
                                historyLog: [{ time: now, event: 'Hệ thống tự động sinh task nghiệm thu báo cáo doanh thu hằng ngày' }]
                             };
                             setTasks(prev => [...prev, newTask]);
                             showToast('✅ Đã lưu Báo cáo Doanh thu và sinh Task tự động thành công!');
                             setActiveTab('tasks');
                          }}
                       />
                    </div>
                  </ErrorBoundary>
                ) : activeTab === 'revenue-log' && user.role === 'FINANCE_DEPT' ? (
                  <ErrorBoundary>
                    <RevenueLogDashboard user={user} facilityList={facilityList.length > 0 ? facilityList : [{id: 'f1', name: 'Cơ sở 1'}, {id: 'f2', name: 'Cơ sở 2'}]} showToast={showToast} />
                  </ErrorBoundary>
                ) : (
                  <>
                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                      <div>
                        <h2 className="text-2xl font-bold text-on-surface dark:text-white">
                          {activeTab === 'internal-tasks' ? `Công việc Nội bộ - ${user.name}` : ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role) ? 'Tổng quan Toàn chuỗi' : `Dashboard - ${(Array.isArray(user.facility_id) && user.facility_id.length > 0) ? user.facility_id.join(', ') : (user.facility_id || user.username || '')}`}
                        </h2>
                        <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">
                          {activeTab === 'internal-tasks' ? 'Quản lý công việc riêng biệt của phòng ban.' : ['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role) ? 'Quản lý và điều phối task trên toàn hệ thống.' : 'Quản lý công việc nội bộ cơ sở.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="bg-surface dark:bg-gray-800 rounded-lg p-1 border border-outline-variant dark:border-gray-700 flex shadow-sm">
                          <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm text-primary dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                            <span className="material-symbols-outlined text-[18px]">view_list</span> Danh sách
                          </button>
                          <button onClick={() => setViewMode('kanban')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${viewMode === 'kanban' ? 'bg-white dark:bg-gray-700 shadow-sm text-primary dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                            <span className="material-symbols-outlined text-[18px]">view_kanban</span> Bảng
                          </button>
                          <button onClick={() => setViewMode('archive')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${viewMode === 'archive' ? 'bg-white dark:bg-gray-700 shadow-sm text-primary dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                            <span className="material-symbols-outlined text-[18px]">history</span> Lịch sử
                          </button>
                        </div>
                        {(!['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role) || activeTab === 'internal-tasks') && (
                          <button onClick={() => setShowCreateModal(true)} className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-md shadow-primary/20 transition-all">
                            <span className="material-symbols-outlined text-[18px]">add</span> Mới
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {user.role === 'DEPARTMENT_HEAD' && activeTab !== 'internal-tasks' && (
                      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 custom-scrollbar">
                        <button
                          onClick={() => setGlobalFacilityFilter('ALL')}
                          className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors border ${globalFacilityFilter === 'ALL' ? 'bg-primary text-white border-primary shadow-sm' : 'bg-surface dark:bg-[#252525] text-gray-600 dark:text-gray-300 border-outline-variant dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                        >
                          Tất cả
                        </button>
                        {activeFacilities.map(fac => (
                          <button
                            key={fac.id}
                            onClick={() => setGlobalFacilityFilter(fac.name)}
                            className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors border ${globalFacilityFilter === fac.name ? 'bg-primary text-white border-primary shadow-sm' : 'bg-surface dark:bg-[#252525] text-gray-600 dark:text-gray-300 border-outline-variant dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                          >
                            {fac.name}
                          </button>
                        ))}
                      </div>
                    )}

                    {viewMode === 'kanban' ? (
                      <GlobalKanbanBoard>
                        <GlobalKanbanColumn title="Cần làm" status="todo" tasks={kanbanTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={!['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role) || activeTab === 'internal-tasks' ? (s) => { setCreateModalStatus(s); setShowCreateModal(true); } : undefined} onQuickAdd={(t) => handleCreateTask({ ...t, status: 'todo' })} onDropTask={handleDropTask} taskComments={taskComments} onOpenAITaskModal={!['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role) || activeTab === 'internal-tasks' ? () => setShowAITaskModal(true) : undefined} isFinanceWorkspace={activeTab === 'internal-tasks' && user.role === 'FINANCE_DEPT'} />
                        <GlobalKanbanColumn title="Đang tiến hành" status="in_progress" tasks={kanbanTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={!['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role) || activeTab === 'internal-tasks' ? (s) => { setCreateModalStatus(s); setShowCreateModal(true); } : undefined} onQuickAdd={(t) => handleCreateTask({ ...t, status: 'in_progress' })} onDropTask={handleDropTask} taskComments={taskComments} isFinanceWorkspace={activeTab === 'internal-tasks' && user.role === 'FINANCE_DEPT'} />
                        <GlobalKanbanColumn title="Hoàn thành" status="done" tasks={kanbanTasks} setSelectedTask={setSelectedTask} onOpenCreateModal={!['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role) || activeTab === 'internal-tasks' ? (s) => { setCreateModalStatus(s); setShowCreateModal(true); } : undefined} onQuickAdd={(t) => handleCreateTask({ ...t, status: 'done' })} onDropTask={handleDropTask} taskComments={taskComments} isFinanceWorkspace={activeTab === 'internal-tasks' && user.role === 'FINANCE_DEPT'} />
                      </GlobalKanbanBoard>
                    ) : viewMode === 'archive' ? (
                      <div className="flex flex-col gap-4">
                        <div className="bg-white dark:bg-[#1e1e1e] p-4 rounded-xl border border-outline-variant dark:border-gray-800 flex flex-wrap gap-3 items-center">
                          <div className="flex-1 min-w-[200px] relative">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">search</span>
                            <input type="text" placeholder="Tìm tên công việc..." value={archiveSearch} onChange={e => setArchiveSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white" />
                          </div>
                          <input type="text" placeholder="Người phụ trách (PIC)" value={archivePic} onChange={e => setArchivePic(e.target.value)} className="px-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white min-w-[150px]" />
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">Từ:</span>
                            <input type="date" value={archiveDateFrom} onChange={e => setArchiveDateFrom(e.target.value)} className="px-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white" />
                            <span className="text-sm text-gray-500">Đến:</span>
                            <input type="date" value={archiveDateTo} onChange={e => setArchiveDateTo(e.target.value)} className="px-3 py-2 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-lg text-sm outline-none dark:text-white" />
                          </div>
                        </div>

                        <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 overflow-hidden">
                          <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400 border-b border-outline-variant dark:border-gray-700">
                              <tr>
                                <th className="px-6 py-4">Tên công việc</th>
                                <th className="px-6 py-4">Cơ sở</th>
                                <th className="px-6 py-4">Người phụ trách</th>
                                <th className="px-6 py-4">Ngày hoàn thành</th>
                                <th className="px-6 py-4 text-right">Chi tiết</th>
                              </tr>
                            </thead>
                            <tbody>
                              {archivedTasks.map(t => {
                                const isFinanceTask = t.department_tag === 'FINANCE' || (t.title || '').toLowerCase().includes('doanh thu') || (t.title || '').toLowerCase().includes('kế toán') || (t.title || '').toLowerCase().includes('tài chính');
                                const displayTag = isFinanceTask ? 'Phòng Kế Toán' : (t.facilityId || t.facility);
                                const tagColorClass = isFinanceTask ? 'text-teal-600 bg-teal-100 dark:bg-teal-900/30' : 'bg-primary/10 text-primary';
                                let displayPic = t.pic;
                                if (isFinanceTask && (t.pic === 'Quản lý cơ sở' || t.assignee_role === 'FACILITY_MANAGER')) {
                                   displayPic = 'Phòng Kế Toán';
                                }
                                return (
                                <tr key={t.id} className="border-b border-outline-variant dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors" onClick={() => setSelectedTask(t)}>
                                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                    {['SUPER_ADMIN', 'ADMIN', 'VICE_PRESIDENT'].includes(t.created_by_role) && (
                                      <span className="relative group/star flex items-center justify-center" title={`${t.priority_level === 'URGENT' ? 'Khẩn cấp' : 'Ưu tiên'} từ Ban Giám đốc`}>
                                         <span className={`material-symbols-outlined text-[18px] drop-shadow-sm ${['SUPER_ADMIN', 'ADMIN'].includes(t.created_by_role) ? 'text-red-500' : 'text-yellow-400'}`} style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                      </span>
                                    )}
                                    {t.title}
                                  </td>
                                  <td className="px-6 py-4"><span className={`${tagColorClass} px-2 py-1 rounded text-xs font-bold uppercase tracking-wider`}>{displayTag}</span></td>
                                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{getDisplayName(displayPic)}</td>
                                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 font-mono">{t.completedAt || 'Legacy'}</td>
                                  <td className="px-6 py-4 text-right">
                                    <button className="text-primary hover:underline font-medium text-xs flex items-center justify-end gap-1">
                                      Xem <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                    </button>
                                  </td>
                                </tr>
                              )})}
                              {archivedTasks.length === 0 && (
                                <tr>
                                  <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">inbox</span>
                                    <p>Không tìm thấy dữ liệu lịch sử phù hợp.</p>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-outline-variant dark:border-gray-800 overflow-hidden">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400">
                            <tr>
                              <th className="px-6 py-4">Task</th>
                              <th className="px-6 py-4">PIC</th>
                              <th className="px-6 py-4">Deadline</th>
                              <th className="px-6 py-4">Trạng thái</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kanbanTasks.map(task => {
                              const isFinanceTask = task.department_tag === 'FINANCE' || (task.title || '').toLowerCase().includes('doanh thu') || (task.title || '').toLowerCase().includes('kế toán') || (task.title || '').toLowerCase().includes('tài chính');
                              let displayPic = task.pic;
                              if (isFinanceTask && (task.pic === 'Quản lý cơ sở' || task.assignee_role === 'FACILITY_MANAGER')) {
                                 displayPic = 'Phòng Kế Toán';
                              }
                              return (
                              <tr key={task.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedTask(task); }} className="cursor-pointer border-b border-outline-variant dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <td className="px-6 py-4">
                                  <div className="font-medium text-on-surface dark:text-white flex items-center gap-2">
                                    {task.title}
                                    {task.is_boss_assigned && (
                                      <span className="relative group/star flex items-center justify-center">
                                        <span className="material-symbols-outlined text-yellow-400 text-[16px] drop-shadow-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500">{task.desc}</div>
                                </td>
                                <td className="px-6 py-4">{getDisplayName(displayPic)}</td>
                                <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{task.deadline}</td>
                                <td className="px-6 py-4"><StatusBadge status={task.status} /></td>
                              </tr>
                            )})}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </main>

          {/* Modals & Overlays */}
          {selectedTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row border border-outline-variant dark:border-gray-800">
                <div className="flex-1 p-6 border-r border-outline-variant dark:border-gray-800 overflow-y-auto">
                  <div className="flex justify-between items-start mb-4 pr-8">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getStatusConfig(selectedTask.status).color}`}>
                      <span className="material-symbols-outlined text-[14px]">{getStatusConfig(selectedTask.status).icon}</span>
                      {getStatusConfig(selectedTask.status).label}
                    </span>
                    <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 md:hidden">
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                  <div className="flex items-start gap-3 mb-2">
                    <h2 className="text-xl font-bold text-on-surface dark:text-white flex-1">{selectedTask.title}</h2>
                    {['SUPER_ADMIN', 'GENERAL_MANAGER', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'FACILITY_MANAGER'].includes(user.role) && viewMode !== 'archive' && (
                      <button
                        onClick={() => {
                          const isPinned = !selectedTask.pinned;
                          setSelectedTask({ ...selectedTask, pinned: isPinned });
                          setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, pinned: isPinned } : t));
                          showToast(isPinned ? `📌 Đã ghim tác vụ: ${selectedTask.title}` : `Bỏ ghim tác vụ: ${selectedTask.title}`);
                          if (isPinned) triggerWebhookAlert({ action: 'PIN_TASK', task_name: selectedTask.title, facility: selectedTask.facilityId || selectedTask.facility, pic: selectedTask.pic, status: 'KHẨN CẤP' });
                        }}
                        className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center shrink-0 ${selectedTask.pinned ? 'bg-orange-100 border-orange-300 text-orange-600 dark:bg-orange-900/30 dark:border-orange-800/50 dark:text-orange-400' : 'bg-surface-container-low border-outline-variant text-gray-400 hover:bg-gray-100 dark:bg-[#252525] dark:border-gray-700 dark:hover:bg-gray-800'}`}
                        title={selectedTask.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
                      >
                        <span className="material-symbols-outlined text-[20px]">{selectedTask.pinned ? 'keep' : 'push_pin'}</span>
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{selectedTask.description || selectedTask.desc}</p>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-surface-container-low dark:bg-[#252525] rounded-xl">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Người phụ trách (PIC)</span>
                      <span className="text-sm font-bold dark:text-white">{getDisplayName(selectedTask.pic)}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-surface-container-low dark:bg-[#252525] rounded-xl">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Cơ sở</span>
                      <span className="text-sm font-bold dark:text-white">{selectedTask.facility}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-error-container/50 dark:bg-red-900/10 rounded-xl border border-error/20">
                      <span className="text-sm font-medium text-error">Hạn chót</span>
                      <input
                        type="date"
                        value={selectedTask.deadline || ''}
                        disabled={viewMode === 'archive' || (['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role) && activeTab !== 'internal-tasks')}
                        onChange={(e) => {
                          const newDeadline = e.target.value;
                          const todayStr = new Date().toISOString().split('T')[0];
                          const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');
                          setSelectedTask({ ...selectedTask, deadline: newDeadline, historyLog: [...(selectedTask.historyLog || []), { time: now, event: `Thay đổi hạn chót: ${newDeadline}` }] });
                          setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, deadline: newDeadline, historyLog: [...(t.historyLog || []), { time: now, event: `Thay đổi hạn chót: ${newDeadline}` }] } : t));
                          if (newDeadline < todayStr && (!selectedTask.deadline || selectedTask.deadline >= todayStr)) {
                            triggerWebhookAlert({ action: 'OVERDUE_TASK', task_name: selectedTask.title, facility: selectedTask.facilityId || selectedTask.facility, pic: selectedTask.pic, status: 'TRỄ HẠN' });
                          }
                        }}
                        className={`text-sm font-bold text-error bg-transparent outline-none cursor-pointer ${viewMode === 'archive' ? 'opacity-70 cursor-not-allowed' : 'hover:bg-error/10'} rounded px-2 py-1 transition-colors`}
                      />
                    </div>
                  </div>

                  {['SUPER_ADMIN', 'VICE_PRESIDENT', 'GENERAL_MANAGER', 'ADMIN'].includes(user.role) && selectedTask.inProgressAt && selectedTask.status === 'in_progress' && (
                    <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800/30 rounded-xl">
                      <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">⏱️ Đã ngâm ở cột Đang tiến hành: {Math.floor((Date.now() - selectedTask.inProgressAt) / 3600000)} giờ {Math.floor(((Date.now() - selectedTask.inProgressAt) % 3600000) / 60000)} phút</p>
                    </div>
                  )}
                  {['SUPER_ADMIN', 'VICE_PRESIDENT', 'GENERAL_MANAGER', 'ADMIN'].includes(user.role) && selectedTask.inProgressAt && selectedTask.completedAtReal && (
                    <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30 rounded-xl">
                      <p className="text-xs text-green-600 dark:text-green-400 font-medium">⏱️ Tổng thời gian thi công (Đang làm &rarr; Hoàn thành): {Math.floor((selectedTask.completedAtReal - selectedTask.inProgressAt) / 3600000)} giờ {Math.floor(((selectedTask.completedAtReal - selectedTask.inProgressAt) % 3600000) / 60000)} phút</p>
                    </div>
                  )}

                  {viewMode !== 'archive' && (!['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user.role) || activeTab === 'internal-tasks' || (user.role === 'FINANCE_DEPT' && selectedTask.title.toLowerCase().includes('doanh thu'))) && (
                    <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-800">

                      <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Thao tác nhanh</h3>
                      <div className="flex gap-3">
                        <button
                          onClick={() => {
                            if (selectedTask.status !== 'todo') return;
                            handleDropTask(selectedTask.id, 'in_progress');
                            setSelectedTask({ ...selectedTask, status: 'in_progress' });
                          }}
                          disabled={selectedTask.status !== 'todo'}
                          className={`flex-1 font-medium py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 ${selectedTask.status === 'todo' ? 'bg-primary hover:bg-primary/90 text-white shadow-primary/20' : 'bg-surface-variant text-gray-400 cursor-not-allowed opacity-50 dark:bg-gray-800 dark:text-gray-500 border border-transparent dark:border-gray-700'}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">rocket_launch</span> Đang làm
                        </button>

                        <button
                          onClick={() => {
                            if (selectedTask.status !== 'in_progress') return;
                            if (user.role === 'FINANCE_DEPT' && selectedTask.title.toLowerCase().includes('doanh thu')) {
                               const revData = selectedTask.revenueData || [];
                               const totalRev = revData.reduce((acc, f) => acc + Number(f.revenue || 0), 0);
                               if (totalRev <= 0) {
                                  showToast('❌ Bắt buộc nhập số liệu doanh thu hợp lệ để nghiệm thu');
                                  return;
                               }
                            }
                            handleDropTask(selectedTask.id, 'done');
                            if (selectedTask.revenueData) {
                               const totalRev = selectedTask.revenueData.reduce((acc, f) => acc + Number(f.revenue || 0), 0);
                               const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');
                               setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, historyLog: [...(t.historyLog || []), { time: now, event: `Ghi nhận Tổng Doanh thu Hệ thống: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalRev)}` }] } : t));
                            }
                            setSelectedTask({ ...selectedTask, status: 'done' });
                          }}
                          disabled={selectedTask.status !== 'in_progress' || (user.role === 'DEPARTMENT_HEAD' && activeTab !== 'internal-tasks') || user.name !== selectedTask.pic || (user.role === 'FINANCE_DEPT' && selectedTask.title.toLowerCase().includes('doanh thu') && (!(selectedTask.revenueData || []).some(f => Number(f.revenue || 0) > 0)))}
                          className={`flex-1 font-medium py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 ${selectedTask.status === 'in_progress' && !(user.role === 'DEPARTMENT_HEAD' && activeTab !== 'internal-tasks') && user.name === selectedTask.pic && !(user.role === 'FINANCE_DEPT' && selectedTask.title.toLowerCase().includes('doanh thu') && (!(selectedTask.revenueData || []).some(f => Number(f.revenue || 0) > 0))) ? 'bg-success hover:bg-success/90 text-white shadow-success/20' : 'bg-surface-variant text-gray-400 cursor-not-allowed opacity-50 dark:bg-gray-800 dark:text-gray-500 border border-transparent dark:border-gray-700'}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">check_circle</span> Hoàn thành
                        </button>
                      </div>

                      {['SUPER_ADMIN', 'GENERAL_MANAGER', 'ADMIN'].includes(user.role) && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => {
                              if (user.role === 'VICE_PRESIDENT') {
                                if (window.showToast) window.showToast('Lỗi 403 (Forbidden): Sếp Phó không có quyền Thu hồi task.', 'error');
                                return;
                              }
                              if (window.confirm("Bạn có chắc chắn muốn thu hồi công việc này? Hành động này sẽ chuyển tác vụ vào mục Lịch sử với trạng thái THU HỒI")) {
                                const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');
                                setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, status: 'revoked', completedAt: new Date().toISOString().split('T')[0], historyLog: [...(t.historyLog || []), { time: now, event: 'THU HỒI CÔNG VIỆC' }] } : t));
                                showToast(`🚨 Task "${selectedTask.title}" đã bị thu hồi bởi Sếp. Vui lòng dừng công việc!`);
                                triggerWebhookAlert({ action: 'REVOKE_TASK', task_name: selectedTask.title, facility: selectedTask.facilityId || selectedTask.facility, pic: selectedTask.pic, status: 'THU HỒI' });
                                setSelectedTask(null);
                              }
                            }}
                            className="flex-1 font-medium py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-700"
                          >
                            <span className="material-symbols-outlined text-[18px]">block</span> Thu hồi
                          </button>
                          {user.role === 'SUPER_ADMIN' && (
                            <button
                              onClick={() => {
                                if (user.role !== 'SUPER_ADMIN') {
                                  if (window.showToast) window.showToast('Lỗi phân quyền: Chỉ Sếp Tổng mới có quyền xóa task.', 'error');
                                  return;
                                }
                                if (window.confirm("CẢNH BÁO: Bạn có chắc chắn muốn XÓA VĨNH VIỄN công việc này khỏi hệ thống? Dữ liệu không thể khôi phục!")) {
                                  setTasks(prev => prev.filter(t => t.id !== selectedTask.id));
                                  showToast(`✅ Đã xóa vĩnh viễn task "${selectedTask.title}"`);
                                  triggerWebhookAlert({ action: 'DELETE_TASK', task_name: selectedTask.title, facility: selectedTask.facilityId || selectedTask.facility, pic: selectedTask.pic, status: 'XÓA VĨNH VIỄN' });
                                  setSelectedTask(null);
                                }
                              }}
                              className="flex-1 font-medium py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-500 hover:bg-red-200 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-800/30"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span> Xóa task
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-800">
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                      Bằng chứng nghiệm thu
                    </h3>

                    {/* TODO: Hệ thống Upload File thật sẽ được đấu nối với AWS S3 / Cloud Storage ở Phase sau, hiện tại chỉ giả lập UI để test luồng */}
                    {!selectedTask.proofImage ? (
                      <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#252525] hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                        onClick={() => {
                          if (viewMode === 'archive') return;
                          const fileInput = document.createElement('input');
                          fileInput.type = 'file';
                          fileInput.accept = 'image/*';
                          fileInput.onchange = (e) => {
                            if (e.target.files && e.target.files[0]) {
                              // Mock upload logic - DO NOT convert to Base64 to save localStorage
                              const mockUrl = `https://via.placeholder.com/400x300.png?text=B%E1%BA%B1ng+ch%E1%BB%A9ng+Nghi%E1%BB%87m+thu+${Date.now().toString().slice(-4)}`;
                              const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');

                              const updatedTask = { ...selectedTask, proofImage: mockUrl, historyLog: [...(selectedTask.historyLog || []), { time: now, event: 'Tải lên ảnh nghiệm thu' }] };
                              setSelectedTask(updatedTask);
                              setTasks(prev => prev.map(t => t.id === selectedTask.id ? updatedTask : t));
                            }
                          };
                          fileInput.click();
                        }}
                      >
                        <span className="material-symbols-outlined text-gray-400 text-3xl mb-2">cloud_upload</span>
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          {viewMode === 'archive' ? 'Không có ảnh đính kèm' : 'Nhấn để tải ảnh lên'}
                        </span>
                      </div>
                    ) : (
                      <div className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 group bg-gray-100 dark:bg-[#252525]">
                        {typeof selectedTask.proofImage === 'string' && selectedTask.proofImage && (
                          <img src={selectedTask.proofImage} alt="Bằng chứng" className="w-full h-48 object-cover" />
                        )}
                        {viewMode !== 'archive' && (
                          <button
                            className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN');
                              const updatedTask = { ...selectedTask, proofImage: null, historyLog: [...(selectedTask.historyLog || []), { time: now, event: 'Xóa ảnh nghiệm thu' }] };
                              setSelectedTask(updatedTask);
                              setTasks(prev => prev.map(t => t.id === selectedTask.id ? updatedTask : t));
                            }}
                            title="Xóa ảnh"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-8 pt-6 border-t border-outline-variant dark:border-gray-800">
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">history</span>
                      Lịch sử hoạt động (AI-Ready Log)
                    </h3>
                    <div className="bg-surface-container-low dark:bg-[#252525] rounded-xl p-4 max-h-48 overflow-y-auto custom-scrollbar">
                      <div className="relative border-l-2 border-outline-variant dark:border-gray-700 ml-3 space-y-4">
                        {(selectedTask.historyLog || [{ time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('vi-VN'), event: 'Hệ thống tự động khởi tạo công việc' }]).map((log, idx) => (
                          <div key={idx} className="relative pl-5">
                            <span className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-white dark:border-[#252525]"></span>
                            <div className="text-xs text-gray-400 mb-0.5">{log.time}</div>
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{log.event}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="w-full md:w-96 flex flex-col bg-surface-container-lowest dark:bg-[#1a1a1a]">
                  <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-white dark:bg-[#1e1e1e]">
                    <h3 className="font-bold text-sm flex items-center gap-2 dark:text-white">
                      <span className="material-symbols-outlined text-primary">forum</span>
                      Thảo luận Task (@)
                    </h3>
                    <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hidden md:block">
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 custom-scrollbar">
                    {(!taskComments[selectedTask.id] || taskComments[selectedTask.id].length === 0) ? (
                      <div className="text-center text-gray-500 dark:text-gray-400 text-sm mt-10">Chưa có bình luận nào. Gõ @ để tag tên thành viên.</div>
                    ) : (
                      taskComments[selectedTask.id].map(comment => (
                        <div key={comment.id} className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">{comment.sender.charAt(0)}</div>
                          <div className="bg-surface-container dark:bg-[#2a2a2a] p-3 rounded-2xl rounded-tl-none text-sm dark:text-gray-200">
                            <div className="flex justify-between items-center gap-4 mb-1">
                              <span className="text-primary dark:text-blue-400 font-bold text-[11px] block">{comment.sender}</span>
                              <span className="text-[10px] text-gray-400">{comment.time}</span>
                            </div>
                            <span>{comment.text}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {viewMode !== 'archive' && (!['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(user.role) || activeTab === 'internal-tasks') ? (
                    <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-white dark:bg-[#1e1e1e]">
                      <div className="relative flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Gõ @ để tag tên..."
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                          className="w-full pl-4 pr-10 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none dark:text-white"
                        />
                        <button onClick={handleAddComment} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:text-primary/80 p-1 flex items-center justify-center">
                          <span className="material-symbols-outlined text-[20px]">send</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 border-t border-outline-variant dark:border-gray-800 bg-white dark:bg-[#1e1e1e] text-center text-xs text-gray-500">
                      Chế độ chỉ xem (Read-only)
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}


          {showAIDrawer && (
            <div className="fixed inset-0 z-50 flex justify-end">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => setShowAIDrawer(false)}></div>
              <div className="relative w-[400px] sm:w-[500px] h-full bg-white dark:bg-[#1e1e1e] shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out animate-slide-in-right">
                <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-secondary/10 to-transparent flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-secondary text-3xl">robot_2</span>
                    <div>
                      <h2 className="font-bold text-lg dark:text-white">Trợ lý Cố vấn AI Cấp cao</h2>
                      <p className="text-xs text-gray-500">Truy cập Global Data Stream</p>
                    </div>
                  </div>
                  <button onClick={() => setShowAIDrawer(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500 transition-colors">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <AIAdvisor isDrawer={true} user={user} activeSessionId={activeAiSessionId} onChatUpdate={() => setAiSessions(JSON.parse(localStorage.getItem('taskflow_ai_sessions') || '[]'))} onNewSession={(id) => { setActiveAiSessionId(id); setAiSessions(JSON.parse(localStorage.getItem('taskflow_ai_sessions') || '[]')); }} />
                </div>
              </div>
            </div>
          )}

          {showCreateModal && (
            <TaskCreationModal onClose={() => setShowCreateModal(false)} onSave={handleCreateTask} defaultStatus={createModalStatus} user={user} />
          )}

          {showAITaskModal && !['ADMIN', 'SUPER_ADMIN'].includes(user.role) && (
            <AITaskModal onClose={() => setShowAITaskModal(false)} onConfirm={handleAITaskConfirm} user={user} showToast={showToast} />
          )}

          {showChangePasswordModal && (
            <ChangePasswordModal 
              user={user} 
              onClose={() => setShowChangePasswordModal(false)} 
              onSuccess={logout} 
            />
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div className={`fixed bottom-6 right-6 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-fade-in z-50 ${toastMessage.includes('❌') ? 'bg-error text-white' : 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900'}`}>
              <span className={`material-symbols-outlined ${toastMessage.includes('❌') ? 'text-white' : 'text-success dark:text-green-600'}`}>
                {toastMessage.includes('❌') ? 'error' : 'check_circle'}
              </span>
              <span className="text-sm font-medium">{toastMessage}</span>
            </div>
          )}
        </div>
      );
    }

    function AppContainer() {
      const [user, setUser] = useState(null);
      const [loading, setLoading] = useState(true);

      useEffect(() => {
        // Dọn dẹp tài khoản demo sysadmin cũ nếu có
        try {
          const storedUsers = localStorage.getItem('taskflow_users');
          if (storedUsers) {
            const usersArr = JSON.parse(storedUsers);
            const filtered = usersArr.filter(u => u.username !== 'sysadmin');
            if (filtered.length !== usersArr.length) {
              localStorage.setItem('taskflow_users', JSON.stringify(filtered));
            }
          }
          // Cleanup script: Hard-delete các task rác có pic là demo data
          const storedTasks = localStorage.getItem('stitch_tasks');
          if (storedTasks) {
             const tasksArr = JSON.parse(storedTasks);
             const filteredTasks = tasksArr.filter(t => t.pic !== 'marketing' && t.pic !== 'Quản lý cơ sở');
             if (filteredTasks.length !== tasksArr.length) {
                localStorage.setItem('stitch_tasks', JSON.stringify(filteredTasks));
                window.dispatchEvent(new Event('taskflow_tasks_updated'));
             }
          }
        } catch (e) {}

        // Migration: Tự động thêm tài khoản ketoan và marketing nếu chưa có trong localStorage
        try {
          const storedUsers = localStorage.getItem('taskflow_users');
          if (storedUsers) {
            let usersArr = JSON.parse(storedUsers);
            let updated = false;
            if (!usersArr.find(u => u.username === 'ketoan')) {
              usersArr.push({ id: 'u3', username: 'ketoan', password: btoa('ketoan123'), name: 'Phòng Kế Toán', role: 'FINANCE_DEPT', facility_id: ['ALL'], isActive: true });
              updated = true;
            }
            if (!usersArr.find(u => u.username === 'marketing')) {
              usersArr.push({ id: 'u4', username: 'marketing', password: btoa('marketing123'), name: 'Phòng Marketing', role: 'DEPARTMENT_HEAD', facility_id: ['ALL'], isActive: true });
              updated = true;
            }
            if (!usersArr.find(u => u.username === 'seppho')) {
              usersArr.push({ id: 'u5', username: 'seppho', password: btoa('seppho123'), name: 'Sếp Phó', role: 'VICE_PRESIDENT', facility_id: 'ALL', isActive: true });
              updated = true;
            }
            if (updated) {
              localStorage.setItem('taskflow_users', JSON.stringify(usersArr));
            }
          }
        } catch (e) {}

        if (!localStorage.getItem('taskflow_users')) {
          localStorage.setItem('taskflow_users', JSON.stringify([
            { id: 'u1', username: 'admin', password: btoa('admin123'), name: 'Sếp Tổng', role: 'SUPER_ADMIN', facility_id: 'ALL', isActive: true },
            { id: 'u5', username: 'seppho', password: btoa('seppho123'), name: 'Sếp Phó', role: 'VICE_PRESIDENT', facility_id: 'ALL', isActive: true },
            { id: 'u2', username: 'manager1', password: btoa('manager123'), name: 'Quản lý Cơ sở 1', role: 'FACILITY_MANAGER', facility_id: 'Cơ sở 1', isActive: true },
            { id: 'u3', username: 'ketoan', password: btoa('ketoan123'), name: 'Phòng Kế Toán', role: 'FINANCE_DEPT', facility_id: ['ALL'], isActive: true },
            { id: 'u4', username: 'marketing', password: btoa('marketing123'), name: 'Phòng Marketing', role: 'DEPARTMENT_HEAD', facility_id: ['ALL'], isActive: true }
          ]));
        }
        if (!localStorage.getItem('taskflow_facilities')) {
          localStorage.setItem('taskflow_facilities', JSON.stringify([
            { id: 'f1', name: 'Cơ sở 1', address: 'Quận 1, TP.HCM', pic: 'Quản lý Cơ sở 1' },
            { id: 'f2', name: 'Cơ sở 2', address: 'Quận 3, TP.HCM', pic: 'Chưa phân công' }
          ]));
        } else {
          let facs = JSON.parse(localStorage.getItem('taskflow_facilities'));
          if (facs.some(f => f.isExecutive || f.id === 'vp1' || f.id === 'vp2')) {
             facs = facs.filter(f => !f.isExecutive && f.id !== 'vp1' && f.id !== 'vp2');
             localStorage.setItem('taskflow_facilities', JSON.stringify(facs));
          }
        }

        const authData = localStorage.getItem('taskflow_auth');
        if (authData) {
          try {
            const parsed = JSON.parse(authData);
            if (parsed && parsed.user) {
              const users = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
              const activeUser = users.find(u => u.username === parsed.user.username);
              if (activeUser && activeUser.isActive) {
                const facilities = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
                if (activeUser.role === 'FACILITY_MANAGER') {
                   const matchStr = Array.isArray(activeUser.facility_id) ? activeUser.facility_id[0] : (activeUser.facility_id || activeUser.username);
                   const matchedFac = facilities.find(f => f.name.toLowerCase() === (matchStr||'').toLowerCase() || f.id.toLowerCase().includes((matchStr||'').toLowerCase()));
                   if (matchedFac) {
                      activeUser.facility_code = matchedFac.name;
                      activeUser.facility_name = `DUBAI ${matchedFac.name.replace('DB', '')}`;
                   } else {
                      activeUser.facility_code = matchStr?.toUpperCase() || 'UNKNOWN';
                      activeUser.facility_name = `DUBAI ${activeUser.facility_code.replace('DB', '')}`;
                   }
                }
                setUser(activeUser);
              } else {
                localStorage.removeItem('taskflow_auth');
              }
            }
          } catch (e) { }
        }
        setLoading(false);

        const interval = setInterval(() => {
          const uAuth = localStorage.getItem('taskflow_auth');
          if (uAuth) {
            const p = JSON.parse(uAuth);
            const us = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
            const activeUs = us.find(x => x.username === p.user.username);
            if (!activeUs || !activeUs.isActive || activeUs.role !== p.user.role || JSON.stringify(activeUs.facility_id) !== JSON.stringify(p.user.facility_id)) {
              localStorage.removeItem('taskflow_auth');
              setUser(null);
            }
          }
        }, 1000);
        return () => clearInterval(interval);
      }, []);

      const login = (userData, token) => {
        const enrichedUser = { ...userData };
        const facilities = JSON.parse(localStorage.getItem('taskflow_facilities') || '[]');
        if (enrichedUser.role === 'FACILITY_MANAGER') {
           const matchStr = Array.isArray(enrichedUser.facility_id) ? enrichedUser.facility_id[0] : (enrichedUser.facility_id || enrichedUser.username);
           const matchedFac = facilities.find(f => f.name.toLowerCase() === (matchStr||'').toLowerCase() || f.id.toLowerCase().includes((matchStr||'').toLowerCase()));
           if (matchedFac) {
              enrichedUser.facility_code = matchedFac.name;
              enrichedUser.facility_name = `DUBAI ${matchedFac.name.replace('DB', '')}`;
           } else {
              enrichedUser.facility_code = matchStr?.toUpperCase() || 'UNKNOWN';
              enrichedUser.facility_name = `DUBAI ${enrichedUser.facility_code.replace('DB', '')}`;
           }
        }
        localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: enrichedUser }));
        setUser(enrichedUser);
      };
      const logout = () => { localStorage.removeItem('taskflow_auth'); setUser(null); };

      if (loading) return null;
      return <AuthContext.Provider value={{ user, login, logout }}>{user ? <MainDashboard /> : <Login />}</AuthContext.Provider>;
    }

    function NavItem({ icon, label, active, onClick }) {
      return (
        <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${active ? 'bg-primary/10 dark:bg-primary/20 text-primary dark:text-blue-400 font-semibold' : 'text-on-surface-variant dark:text-gray-400 hover:bg-surface-variant dark:hover:bg-gray-800 hover:text-on-surface dark:hover:text-gray-200'}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
          {label}
        </button>
      );
    }

    const getStatusConfig = (status) => {
      switch (status) {
        case 'todo': return { label: 'Cần làm', color: 'bg-surface-variant text-on-surface-variant border-outline-variant dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700', icon: 'pending' };
        case 'in_progress': return { label: 'Đang tiến hành', color: 'bg-primary/10 text-primary border-primary/20 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50', icon: 'sync' };
        case 'review': return { label: 'Nghiệm thu', color: 'bg-secondary/10 text-secondary border-secondary/20 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800/50', icon: 'assignment_turned_in' };
        case 'done': return { label: 'Hoàn thành', color: 'bg-success/10 text-success border-success/20 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50', icon: 'check_circle' };
        case 'revoked': return { label: 'THU HỒI', color: 'bg-gray-200 text-red-600 border-gray-400 dark:bg-[#252525] dark:text-red-500 dark:border-gray-600 font-bold', icon: 'block' };
        default: return { label: 'Unknown', color: 'bg-gray-100 text-gray-500', icon: 'help' };
      }
    };

    function StatusBadge({ status }) {
      const config = getStatusConfig(status);
      return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`}>{config.label}</span>;
    }
    // --- GLOBAL UI COMPONENTS ---
    function GlobalKanbanBoard({ children }) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch h-[calc(100vh-160px)]">
          {children}
        </div>
      );
    }

    function GlobalKanbanColumn({ title, status, tasks, setSelectedTask, onOpenCreateModal, onQuickAdd, onDropTask, taskComments, onOpenAITaskModal, isFinanceWorkspace }) {
      const columnTasks = tasks.filter(t => t.status === status);
      const [showQuickAdd, setShowQuickAdd] = useState(false);
      const [quickTitle, setQuickTitle] = useState('');
      const inputRef = React.useRef(null);

      const sortedColumnTasks = [...columnTasks].sort((a, b) => {
        const todayStr = new Date().toISOString().split('T')[0];
        const getPriority = (task) => {
          if (task.pinned) return 0;
          if (!task.deadline) return 4;
          if (task.deadline < todayStr) return 1;
          if (task.deadline === todayStr) return 2;
          return 3;
        };
        const pA = getPriority(a);
        const pB = getPriority(b);
        if (pA !== pB) return pA - pB;
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
        return 0;
      });

      React.useEffect(() => {
        if (showQuickAdd && inputRef.current) inputRef.current.focus();
      }, [showQuickAdd]);

      const handleQuickSubmit = () => {
        if (quickTitle.trim()) {
          onQuickAdd({ title: quickTitle.trim(), status, desc: '' });
          setQuickTitle('');
          setShowQuickAdd(false);
        }
      };

      const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleQuickSubmit();
        else if (e.key === 'Escape') { setShowQuickAdd(false); setQuickTitle(''); }
      };

      const getDeadlineBadge = (deadline) => {
        if (!deadline) return null;
        const todayStr = new Date().toISOString().split('T')[0];
        if (deadline < todayStr) return <span className="bg-error/10 text-error px-2 py-0.5 rounded text-[10px] font-bold border border-error/20">Đã trễ</span>;
        if (deadline === todayStr) return <span className="bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-500/20">Sắp trễ</span>;
        return null;
      };

      return (
        <div
          className="flex flex-col bg-surface-container dark:bg-[#1a1a1a] rounded-xl border border-outline-variant dark:border-gray-800/50 p-4 h-full global-kanban-column"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const taskId = e.dataTransfer.getData('taskId');
            if (taskId && onDropTask) onDropTask(parseInt(taskId), status);
          }}
        >
          <div className="flex flex-col mb-4 shrink-0 gap-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                {title} <span className="bg-white dark:bg-gray-800 border border-outline-variant dark:border-gray-700 text-gray-500 px-2 py-0.5 rounded-full text-xs">{columnTasks.length}</span>
              </h3>
            </div>
            {status === 'todo' && onOpenAITaskModal && (
              <button onClick={onOpenAITaskModal} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-secondary/10 to-purple-500/10 hover:from-secondary/20 hover:to-purple-500/20 text-secondary dark:text-purple-400 border border-secondary/30 dark:border-purple-500/30 rounded-xl py-2 px-4 text-sm font-bold transition-all shadow-sm">
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span> Tạo nhanh bằng AI
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto custom-scrollbar flex-1 pb-2 pr-1">
            {sortedColumnTasks.map(task => {
              const isFinanceTask = isFinanceWorkspace || task.department_tag === 'FINANCE' || (task.title || '').toLowerCase().includes('doanh thu') || (task.title || '').toLowerCase().includes('kế toán') || (task.title || '').toLowerCase().includes('tài chính');
              const displayTag = isFinanceTask ? 'Phòng Kế Toán' : (task.facilityId || task.facility);
              const tagColorClass = isFinanceTask ? 'text-teal-600 bg-teal-100 dark:bg-teal-900/30 dark:text-teal-400' : 'text-primary dark:text-blue-400 bg-primary/10 dark:bg-primary/20';
              let displayPic = task.pic;
              if (isFinanceTask && (task.pic === 'Quản lý cơ sở' || task.assignee_role === 'FACILITY_MANAGER')) {
                 displayPic = 'Phòng Kế Toán';
              }
              return (
              <div
                key={task.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('taskId', task.id.toString())}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedTask(task); }}
                className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-outline-variant dark:border-gray-700 hover:shadow-md transition-shadow cursor-pointer group shrink-0"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${tagColorClass}`}>{displayTag}</span>
                  <div className="flex items-center gap-1">
                    {['SUPER_ADMIN', 'ADMIN', 'VICE_PRESIDENT'].includes(task.created_by_role) ? (
                      <div className="flex flex-col items-center leading-none mt-1">
                         <span className="relative group/star flex items-center justify-center" title="Chỉ đạo từ Ban Giám đốc">
                            <span className={`material-symbols-outlined text-[18px] drop-shadow-sm ${['SUPER_ADMIN', 'ADMIN'].includes(task.created_by_role) ? 'text-red-500' : 'text-yellow-400'}`} style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                         </span>
                         <span className={`text-[8px] font-bold px-1 rounded uppercase mt-0.5 ${task.priority_level === 'URGENT' ? 'bg-red-500 text-white' : 'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400'}`} style={{ fontSize: '7px' }}>
                            {task.priority_level === 'URGENT' ? 'Khẩn cấp' : 'Ưu tiên'}
                         </span>
                      </div>
                    ) : task.is_boss_assigned ? (
                      <span className="relative group/star flex items-center justify-center">
                         <span className="material-symbols-outlined text-yellow-400 text-[18px] drop-shadow-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                      </span>
                    ) : null}
                    {task.pinned && <span className="material-symbols-outlined text-orange-500 text-[16px]" title="Đã ghim">push_pin</span>}
                    {getDeadlineBadge(task.deadline)}
                    {task.aiPinged && <span className="material-symbols-outlined text-secondary text-[16px] animate-pulse" title="AI đã nhắc việc">notifications_active</span>}
                    {task.urgent && <span className="material-symbols-outlined text-error text-[16px]" title="Khẩn cấp">error</span>}
                  </div>
                </div>
                <h4 className="text-sm font-semibold text-on-surface dark:text-gray-100 mb-2 leading-snug">{task.title}</h4>
                <div className="flex items-center justify-between mt-4 border-t border-outline-variant dark:border-gray-700/50 pt-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300" title={getDisplayName(displayPic)}>
                      {displayPic === 'Phòng Kế Toán' ? 'PK' : displayPic.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{getDisplayName(displayPic)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400 hover:text-secondary transition-colors" title="Thảo luận (Task-Chat)">
                    <span className="material-symbols-outlined text-[16px]">forum</span>
                    <span className="text-xs">{(taskComments && taskComments[task.id] && taskComments[task.id].length) || 0}</span>
                  </div>
                </div>
              </div>
            )})}

            {columnTasks.length === 0 && !showQuickAdd && (
               <div className="flex flex-col items-center justify-center p-6 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-gray-400 mt-2 shrink-0 bg-gray-50/50 dark:bg-[#1e1e1e]/50">
                  <span className="material-symbols-outlined text-[32px] text-gray-300 dark:text-gray-600 mb-2">inbox</span>
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Hiện chưa có công việc nào.</span>
               </div>
            )}

            {showQuickAdd && status !== 'done' && (
              <div className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-primary dark:border-blue-500 mt-2 shrink-0">
                <input ref={inputRef} type="text" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => quickTitle.trim() ? handleQuickSubmit() : setShowQuickAdd(false)} placeholder="Nhập tiêu đề (Enter để lưu)..." className="w-full text-sm outline-none bg-transparent dark:text-white" />
              </div>
            )}
          </div>

          {status !== 'done' && onOpenCreateModal && (
            <div className="mt-2 shrink-0 pt-3 border-t border-outline-variant dark:border-gray-800/50">
              {!showQuickAdd && (
                <div className="flex gap-2">
                  <button onClick={() => setShowQuickAdd(true)} className="flex-1 py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700" title="Quick Add">
                    <span className="material-symbols-outlined text-[18px]">bolt</span>
                  </button>
                  <button onClick={() => onOpenCreateModal(status)} className="flex-[3] py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700">
                    <span className="material-symbols-outlined text-[18px] mr-1">add</span> Thêm
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(
      <ErrorBoundary>
        <AppContainer />
      </ErrorBoundary>
    );
  </script>
</body>

</html>

