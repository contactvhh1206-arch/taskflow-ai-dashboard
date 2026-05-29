import re

with open('C:/Users/Hoang/Desktop/hub-dubai/agent/rules/stitch_smart_ai_task_management_system/src/components/RAGManagerPanel.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update UI Text
text = text.replace(
    '<p className="text-sm text-gray-500 mb-4">Hỗ trợ: PDF, DOCX, TXT, CSV (Tối đa 10MB)</p>',
    '<p className="text-sm text-gray-500 mb-4">Chỉ hỗ trợ: TXT (Tối đa 500KB - Khuyên dùng NotebookLM để trích xuất trước khi nạp)</p>'
)

# 2. Update Input Accept
text = text.replace(
    '<input type="file" className="hidden" accept=".pdf,.docx,.txt,.csv" onChange={handleFileInput} />',
    '<input type="file" className="hidden" accept=".txt, text/plain" onChange={handleFileInput} />'
)

# 3. Replace handleFiles with handleFileUpload and update handlers
old_handlers = r"      const handleDrop = \(e\) => \{\s*e\.preventDefault\(\);\s*setIsDragging\(false\);\s*if \(e\.dataTransfer\.files && e\.dataTransfer\.files\.length > 0\) \{\s*handleFiles\(e\.dataTransfer\.files\);\s*\}\s*\};\s*const handleFileInput = \(e\) => \{\s*if \(e\.target\.files && e\.target\.files\.length > 0\) \{\s*handleFiles\(e\.target\.files\);\s*\}\s*\};\s*const handleFiles = async \(files\) => \{[\s\S]*?\};\s*const handleDelete"

new_handlers = """      const handleDrop = (e) => {
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
        if (!file.name.endsWith('.txt')) {
            alert("Hệ thống từ chối: Chỉ chấp nhận file .txt!");
            return;
        }
        if (file.size > 500 * 1024) {
            alert("File quá lớn! Vui lòng giới hạn file txt dưới 500KB.");
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        
        setIsUploading(true);

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/rag/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('taskflow_token')}`
                    // Lưu ý: Tuyệt đối KHÔNG set 'Content-Type': 'multipart/form-data'. Browser sẽ tự sinh boundary.
                },
                body: formData
            });
            
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            
            alert("Thành công: " + data.message);
            
            // Cập nhật danh sách UI
            const newDoc = {
                id: Date.now().toString(),
                name: file.name,
                type: file.type || 'text/plain',
                size: (file.size / 1024).toFixed(1) + ' KB',
                chunks: data.chunks_processed || '-',
                status: 'Đã mã hóa',
                uploadDate: new Date().toISOString()
            };
            setDocuments(prev => [newDoc, ...prev]);
        } catch (error) {
            alert("Lỗi tải lên: " + error.message);
        } finally {
            setIsUploading(false);
        }
      };

      const handleDelete"""

text = re.sub(old_handlers, new_handlers, text)

with open('C:/Users/Hoang/Desktop/hub-dubai/agent/rules/stitch_smart_ai_task_management_system/src/components/RAGManagerPanel.jsx', 'w', encoding='utf-8') as f:
    f.write(text)

print("Patch applied to RAGManagerPanel.jsx")
