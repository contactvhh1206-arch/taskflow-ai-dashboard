import React from 'react';

export default function AIBatchPreviewModal({ data, onCancel, onConfirm, facilities }) {
       return (
         <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
           <div className="w-full max-w-4xl bg-white dark:bg-[#121212] rounded-2xl overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col max-h-[90vh]">
             <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-[#1e1e1e]">
               <div>
                 <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                   <span className="material-symbols-outlined text-purple-600">auto_awesome</span> 
                   Xem trước Dữ liệu Trích xuất AI
                 </h2>
                 <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Vui lòng kiểm tra lại số liệu trước khi lưu hàng loạt.</p>
               </div>
             </div>
             <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-sm text-left border border-gray-200 dark:border-gray-800">
                    <thead className="bg-[#e2eaf5] dark:bg-blue-900/30">
                      <tr>
                        <th className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">Ngày</th>
                        {facilities.map(f => (
                           <th key={f.id} className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 font-bold text-gray-700 dark:text-gray-300 text-right whitespace-nowrap">{f.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((row, i) => (
                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800 bg-[#f9fafb] dark:bg-[#1a1a1a]">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                            {row.date ? row.date.split('-').reverse().join('/') : ''}
                          </td>
                          {facilities.map(f => {
                             const facNameShort = f.name.replace('DUBAI ', '');
                             const val = row.revenues[f.name] || row.revenues[facNameShort] || 0;
                             return (
                               <td key={f.id} className="px-4 py-3 text-right text-gray-900 dark:text-gray-100 whitespace-nowrap">{new Intl.NumberFormat('vi-VN').format(val)}</td>
                             );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-[#c2d0e7] dark:bg-blue-900/60 font-bold">
                      <tr>
                        <td className="px-4 py-3 text-gray-900 dark:text-white uppercase whitespace-nowrap">Tổng {data.length} Ngày</td>
                        {facilities.map(f => {
                           const facNameShort = f.name.replace('DUBAI ', '');
                           const total = data.reduce((acc, row) => acc + Number(row.revenues[f.name] || row.revenues[facNameShort] || 0), 0);
                           return (
                             <td key={f.id} className="px-4 py-3 text-right text-teal-700 dark:text-teal-400 whitespace-nowrap">{new Intl.NumberFormat('vi-VN').format(total)}</td>
                           );
                        })}
                      </tr>
                    </tfoot>
                  </table>
                </div>
             </div>
             <div className="p-6 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1e1e1e] flex justify-end gap-3">
                <button onClick={onCancel} className="px-5 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded font-bold hover:bg-gray-100 dark:hover:bg-gray-800 transition">Hủy bỏ</button>
                <button onClick={() => onConfirm(data)} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded font-bold transition flex items-center gap-2 shadow-md">
                   <span className="material-symbols-outlined text-[18px]">save</span> Xác nhận & Lưu hàng loạt
                </button>
             </div>
           </div>
         </div>
       );
    }
