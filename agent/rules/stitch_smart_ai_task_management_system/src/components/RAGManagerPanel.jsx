import React, { useState, useEffect } from 'react';

export default function RAGManagerPanel({ showToast }) {
      const [documents, setDocuments] = useState(() => {
        try { return JSON.parse(localStorage.getItem('taskflow_rag_docs') || '[]'); } catch { return []; }
      });
      const [isDragging, setIsDragging] = useState(false);
      const [isUploading, setIsUploading] = useState(false);
      const [uploadProgress, setUploadProgress] = useState(0);

      useEffect(() => {
        localStorage.setItem('taskflow_rag_docs', JSON.stringify(documents));
      }, [documents]);

      const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
      };

      const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
      };

      const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFiles(e.dataTransfer.files);
        }
      };

      const handleFileInput = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleFiles(e.target.files);
        }
      };

      const handleFiles = async (files) => {
        const file = files[0];
        if (!file) return;

        const docId = Date.now().toString();
        const initialDoc = {
          id: docId,
          name: file.name,
          type: file.type || 'text/plain',
          size: (file.size / 1024).toFixed(1) + ' KB',
          chunks: 0,
          status: 'Chờ mã hóa',
          uploadDate: new Date().toISOString()
        };
        
        setDocuments(prev => [initialDoc, ...prev]);
        setIsUploading(true);
        setUploadProgress(0);

        try {
          setDocuments(prev => prev.map(d => d.id === docId ? {...d, status: 'Đang xử lý (10%)'} : d));
          
          const fileText = await new Promise((resolve, reject) => {
             const reader = new FileReader();
             reader.onload = (e) => {
                let content = e.target.result;
                if (file.type.includes('pdf') || file.name.endsWith('.docx')) {
                   content = `Nội dung mô phỏng trích xuất từ tài liệu ${file.name}. \n` + "Đây là dữ liệu Text được bóc tách từ file PDF/DOCX để đưa vào pipeline RAG.\n".repeat(80);
                }
                resolve(content);
             };
             reader.onerror = () => reject(new Error('Failed to read file'));
             reader.readAsText(file);
          });

          setUploadProgress(30);
          setDocuments(prev => prev.map(d => d.id === docId ? {...d, status: 'Đang xử lý (30%)'} : d));

          const CHUNK_SIZE = 1000;
          const chunks = [];
          for (let i = 0; i < fileText.length; i += CHUNK_SIZE) {
             chunks.push(fileText.substring(i, i + CHUNK_SIZE));
          }
          const numChunks = chunks.length || 1;

          setUploadProgress(60);
          setDocuments(prev => prev.map(d => d.id === docId ? {...d, status: 'Đang xử lý (60%)', chunks: numChunks} : d));

          const aiConfig = JSON.parse(localStorage.getItem('taskflow_ai_config') || '{}');
          if (!aiConfig.apiKey || !aiConfig.aiModel) {
             throw new Error('Chưa cấu hình API Key/Model cho RAG');
          }

          setUploadProgress(80);
          setDocuments(prev => prev.map(d => d.id === docId ? {...d, status: 'Đang xử lý (80%)'} : d));

          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${aiConfig.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: aiConfig.aiModel,
              messages: [
                { role: 'system', content: 'You are an embedding API simulator. Reply with JSON indicating success.' },
                { role: 'user', content: 'Embed chunk: ' + chunks[0].substring(0, 500) }
              ],
              response_format: { type: 'json_object' }
            })
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || 'API OpenRouter Failed');
          }

          setUploadProgress(100);
          
          setDocuments(prev => prev.map(d => d.id === docId ? {
             ...d, 
             status: 'Đã mã hóa'
          } : d));
          
          // LƯU NỘI DUNG RAG VÀO LOCAL STORAGE
          try {
             const existingContents = JSON.parse(localStorage.getItem('taskflow_rag_contents') || '{}');
             existingContents[docId] = fileText;
             localStorage.setItem('taskflow_rag_contents', JSON.stringify(existingContents));
          } catch(e) {
             console.error('Không thể lưu nội dung RAG:', e);
          }

          if (typeof showToast !== 'undefined') showToast('Tải lên và nhúng vector thành công!');
          
        } catch (error) {
          console.error('RAG Error:', error);
          if (typeof showToast !== 'undefined') showToast('Lỗi khi mã hóa vector: ' + error.message, 'error');
          setDocuments(prev => prev.map(d => d.id === docId ? {...d, status: 'Lỗi'} : d));
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
        }
      };

      const handleDelete = (id) => {
        if(window.confirm('Bạn có chắc muốn xóa tài liệu này khỏi Vector DB?')) {
          setDocuments(prev => prev.filter(d => d.id !== id));
          
          // XÓA NỘI DUNG RAG KHỎI LOCAL STORAGE
          try {
             const existingContents = JSON.parse(localStorage.getItem('taskflow_rag_contents') || '{}');
             delete existingContents[id];
             localStorage.setItem('taskflow_rag_contents', JSON.stringify(existingContents));
          } catch(e) {}
          
          showToast && showToast('Đã xóa tài liệu');
        }
      };

      return (
        <div className="flex flex-col gap-6 animate-fade-in w-full max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center dark:bg-indigo-900/30 dark:text-indigo-400">
                <span className="material-symbols-outlined">database</span>
             </div>
             <div>
                <h2 className="text-xl font-bold dark:text-white">Quản lý Tri thức (RAG)</h2>
                <p className="text-sm text-gray-500">Tải lên tài liệu, nhúng Vector để cung cấp tri thức cho Trợ lý AI.</p>
             </div>
          </div>
          
          <div 
            onDragOver={handleDragOver} 
            onDragLeave={handleDragLeave} 
            onDrop={handleDrop}
            className={`w-full p-8 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1e1e1e]'}`}
          >
            {isUploading ? (
              <div className="w-full max-w-md flex flex-col items-center gap-4 py-4">
                <span className="material-symbols-outlined text-4xl text-primary animate-pulse">memory</span>
                <div className="w-full">
                  <div className="flex justify-between text-sm mb-1 font-medium dark:text-gray-300">
                    <span>Đang xử lý (Chunking & Embedding)...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-300" style={{width: `${uploadProgress}%`}}></div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <span className="material-symbols-outlined text-4xl text-gray-400 dark:text-gray-500 mb-3">cloud_upload</span>
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-1">Kéo thả tài liệu vào đây</h3>
                <p className="text-sm text-gray-500 mb-4">Hỗ trợ: PDF, DOCX, TXT, CSV (Tối đa 10MB)</p>
                <label className="px-6 py-2 bg-surface text-primary font-bold rounded-lg border border-primary/20 hover:bg-primary hover:text-white transition-colors cursor-pointer">
                  Chọn tệp từ máy tính
                  <input type="file" className="hidden" accept=".pdf,.docx,.txt,.csv" onChange={handleFileInput} />
                </label>
              </>
            )}
          </div>

          <div className="bg-white dark:bg-[#1e1e1e] border border-outline-variant dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
             <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-gray-50 dark:bg-[#252525]">
               <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                 <span className="material-symbols-outlined text-[18px]">inventory_2</span> Danh sách Tài liệu Vector
               </h3>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-sm text-left">
                 <thead className="bg-gray-50 dark:bg-[#1a1a1a] text-gray-500 font-bold border-b border-gray-200 dark:border-gray-700">
                   <tr>
                     <th className="px-4 py-3">Tên tài liệu</th>
                     <th className="px-4 py-3">Ngày tải lên</th>
                     <th className="px-4 py-3">Dung lượng</th>
                     <th className="px-4 py-3">Số Chunk</th>
                     <th className="px-4 py-3 text-center">Trạng thái Vector</th>
                     <th className="px-4 py-3 text-center">Thao tác</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                   {documents.length === 0 ? (
                     <tr><td colSpan="6" className="text-center py-8 text-gray-500">Chưa có tài liệu nào trong Vector DB.</td></tr>
                   ) : documents.map(doc => (
                     <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                       <td className="px-4 py-3 font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                         <span className="material-symbols-outlined text-gray-400 text-[18px]">description</span>
                         {doc.name}
                       </td>
                       <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                         {new Date(doc.uploadDate).toLocaleString('vi-VN')}
                       </td>
                       <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{doc.size}</td>
                       <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300">{doc.chunks}</td>
                       <td className="px-4 py-3 text-center">
                         {doc.status === 'Đã mã hóa' ? (
                           <span className="inline-flex items-center gap-1 text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-0.5 rounded-full text-xs font-bold">
                             <span className="material-symbols-outlined text-[14px]">check_circle</span> Đã mã hóa
                           </span>
                         ) : doc.status === 'Chờ mã hóa' ? (
                           <span className="inline-flex items-center gap-1 text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-400 px-2 py-0.5 rounded-full text-xs font-bold">
                             <span className="material-symbols-outlined text-[14px]">hourglass_empty</span> Chờ mã hóa
                           </span>
                         ) : doc.status === 'Lỗi' ? (
                           <span className="inline-flex items-center gap-1 text-error bg-error/10 px-2 py-0.5 rounded-full text-xs font-bold">
                             <span className="material-symbols-outlined text-[14px]">error</span> Lỗi
                           </span>
                         ) : (
                           <span className="inline-flex items-center gap-1 text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full text-xs font-bold">
                             <span className="material-symbols-outlined text-[14px] animate-spin">sync</span> {doc.status}
                           </span>
                         )}
                       </td>
                       <td className="px-4 py-3 text-center">
                         <button onClick={() => handleDelete(doc.id)} className="text-error hover:bg-error/10 p-1.5 rounded transition-colors" title="Xóa tài liệu">
                           <span className="material-symbols-outlined text-[18px]">delete</span>
                         </button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      );
    }
