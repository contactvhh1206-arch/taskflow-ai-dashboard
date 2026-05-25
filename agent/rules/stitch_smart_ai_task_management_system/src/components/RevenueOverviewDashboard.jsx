import React from 'react';
import HeatmapKPI from './HeatmapKPI';
import AIBatchPreviewModal from './AIBatchPreviewModal';

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
               } catch {
                   setAiError('Không thể lấy lịch sử dữ liệu để phân tích doanh thu.');
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

    