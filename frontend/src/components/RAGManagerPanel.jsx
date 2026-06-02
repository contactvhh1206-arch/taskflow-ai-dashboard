import React, { useState, useEffect } from 'react';

export default function RAGManagerPanel({ showToast }) {
      const [documents, setDocuments] = useState([]);
      const [isDragging, setIsDragging] = useState(false);
      const [isUploading, setIsUploading] = useState(false);
      const [isLoadingDocs, setIsLoadingDocs] = useState(true);
      const [deletingIds, setDeletingIds] = useState(new Set());

      useEffect(() => {
          let isMounted = true; 
          
          const fetchDocuments = async () => {
              setIsLoadingDocs(true);
              try {
                  const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';
                  const response = await fetch(`${API_BASE_URL}/api/rag/documents`, {
                      headers: { 'Authorization': `Bearer ${localStorage.getItem('taskflow_token')}` }
                  });
                  
                  if (!response.ok) throw new Error('Lỗi lấy danh sách tài liệu');
                  
                  const data = await response.json();
                  
                  if (data.success && isMounted) {
                      setDocuments(data.data);
                  }
              } catch (error) {
                  console.error("Lỗi fetch RAG docs:", error);
                  if (isMounted && showToast) showToast("Không thể tải danh sách tài liệu Vector.");
              } finally {
                  if (isMounted) setIsLoadingDocs(false);
              }
          };

          fetchDocuments();

          return () => {
              isMounted = false; 
          };
      }, []);

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
          handleFileUpload(e.dataTransfer.files[0]);
        }
      };

      const handleFileInput = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleFileUpload(e.target.files[0]);
        }
      };

      const handleFileUpload = async (file) => {
        if (!file.name.toLowerCase().endsWith('.txt')) {
            alert("Hệ thống từ chối: Chỉ chấp nhận file .txt!");
            return;
        }
        if (file.size > 500 * 1024) {
            alert("Hệ thống từ chối: File quá lớn! Vui lòng giới hạn file txt dưới 500KB.");
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        
        setIsUploading(true);

        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';
            const response = await fetch(`${API_BASE_URL}/api/rag/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('taskflow_token')}` },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `Lỗi Server (${response.status})`;
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error || errorMessage;
                } catch (e) {
                    console.error("HTML Error:", errorText.substring(0, 100));
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();
            if (showToast) showToast("Thành công: " + data.message);
            
            const newDoc = {
                id: data.document_id,
                file_name: file.name,
                file_size: file.size,
                chunk_count: data.chunks_processed || '-', 
                status: 'Đã mã hóa',
                created_at: new Date().toISOString()
            };
            setDocuments(prev => [newDoc, ...prev]);
        } catch (error) {
            alert("Lỗi tải lên: " + error.message);
        } finally {
            setIsUploading(false);
        }
      };

      const handleDelete = async (id) => {
        if(!window.confirm('CẢNH BÁO: Hành động này sẽ xóa hoàn toàn tài liệu và toàn bộ Vector trong Không gian RAG. Bạn có chắc chắn?')) return;
        
        setDeletingIds(prev => new Set(prev).add(id));

        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';
            const response = await fetch(`${API_BASE_URL}/api/rag/documents/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('taskflow_token')}` }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setDocuments(prev => prev.filter(d => d.id !== id));
                if (showToast) showToast('Đã dọn dẹp tài liệu và Vector thành công.');
            } else {
                throw new Error(data.error || 'Lỗi không xác định từ máy chủ.');
            }
        } catch (error) {
            console.error("Lỗi xóa tài liệu RAG:", error);
            alert("Lỗi khi xóa tài liệu: " + error.message);
        } finally {
            setDeletingIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
            });
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
                  </div>
                  <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-primary transition-all duration-300 w-full animate-pulse"></div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <span className="material-symbols-outlined text-4xl text-gray-400 dark:text-gray-500 mb-3">cloud_upload</span>
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-1">Kéo thả tài liệu vào đây</h3>
                <p className="text-sm text-gray-500 mb-4">Chỉ hỗ trợ: TXT (Tối đa 500KB - Khuyên dùng NotebookLM để trích xuất trước khi nạp)</p>
                <label className="px-6 py-2 bg-surface text-primary font-bold rounded-lg border border-primary/20 hover:bg-primary hover:text-white transition-colors cursor-pointer">
                  Chọn tệp từ máy tính
                  <input type="file" className="hidden" accept=".txt, text/plain" onChange={handleFileInput} />
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
                     <th className="px-4 py-3 text-center">Số Chunk</th>
                     <th className="px-4 py-3 text-center">Trạng thái Vector</th>
                     <th className="px-4 py-3 text-center">Thao tác</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                   {isLoadingDocs ? (
                       <tr><td colSpan="6" className="text-center py-8 text-gray-500"><span className="material-symbols-outlined animate-spin mr-2">sync</span> Đang tải dữ liệu...</td></tr>
                   ) : documents.length === 0 ? (
                     <tr><td colSpan="6" className="text-center py-8 text-gray-500">Chưa có tài liệu nào trong Vector DB.</td></tr>
                   ) : documents.map(doc => {
                     const isDeleting = deletingIds.has(doc.id);
                     return (
                     <tr key={doc.id} className={`hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors ${isDeleting ? 'opacity-50' : ''}`}>
                       <td className="px-4 py-3 font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                         <span className="material-symbols-outlined text-gray-400 text-[18px]">description</span>
                         {doc.file_name || doc.name}
                       </td>
                       <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                         {new Date(doc.created_at || doc.uploadDate).toLocaleString('vi-VN')}
                       </td>
                       <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                         {doc.file_size ? (doc.file_size / 1024).toFixed(1) + ' KB' : doc.size}
                       </td>
                       <td className="px-4 py-3 text-center font-mono text-gray-600 dark:text-gray-300">
                         {doc.chunk_count || doc.chunks}
                       </td>
                       <td className="px-4 py-3 text-center">
                         <span className="inline-flex items-center gap-1 text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-0.5 rounded-full text-xs font-bold">
                           <span className="material-symbols-outlined text-[14px]">check_circle</span> Đã mã hóa
                         </span>
                       </td>
                       <td className="px-4 py-3 text-center">
                         <button 
                            onClick={() => handleDelete(doc.id)} 
                            disabled={isDeleting}
                            className={`p-1.5 rounded transition-colors ${isDeleting ? 'text-gray-400 cursor-not-allowed' : 'text-error hover:bg-error/10'}`} 
                            title="Xóa tài liệu khỏi DB"
                         >
                           {isDeleting ? (
                               <span className="material-symbols-outlined text-[18px] animate-spin">sync</span>
                           ) : (
                               <span className="material-symbols-outlined text-[18px]">delete</span>
                           )}
                         </button>
                       </td>
                     </tr>
                   )})}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      );
    }
