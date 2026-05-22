import React, { useState, useContext } from 'react';
import { AuthContext } from '../App.jsx';

export default function AITaskModal({ onClose, onConfirm, user }) {
  const [text, setText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [draftTasks, setDraftTasks] = useState(null);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setIsAnalyzing(true);
    
    try {
      const systemPrompt = `Bạn là một Trợ lý Quản lý Dự án. Nhiệm vụ của bạn là đọc đoạn văn bản người dùng cung cấp và trích xuất ra danh sách các công việc cần làm.
BẮT BUỘC trả về định dạng JSON thuần túy là một mảng (Array) các Object. Không kèm theo text giải thích nào khác.
Hôm nay là ngày: ${new Date().toLocaleDateString()}. Hãy dùng ngày này để tính toán Hạn chót.
Cấu trúc mỗi Object phải chuẩn xác như sau:
[
{ "title": "Tên công việc ngắn gọn", "description": "Chi tiết công việc", "pic": "Tên người phụ trách (nếu có)", "deadline": "YYYY-MM-DD (nếu có)", "priority": "Cao/Vừa/Thấp" }
]`;

      const API_URL = import.meta.env?.VITE_AI_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
      const API_KEY = import.meta.env?.VITE_AI_API_KEY || 'YOUR_API_KEY_HERE';

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      let content = data.choices[0].message.content;
      
      // Clean markdown formatting if any
      content = content.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const parsedTasks = JSON.parse(content);

      if (!Array.isArray(parsedTasks)) {
        throw new Error('Invalid JSON format: Expected an array');
      }

      // Map Dữ liệu (Hydration)
      const mappedTasks = parsedTasks.map(task => ({
        id: Date.now() + Math.random(),
        title: task.title || 'Task mới',
        desc: task.description || '',
        pic: task.pic || user.name,
        deadline: task.deadline || new Date().toISOString().split('T')[0],
        status: 'todo', // Gán mặc định status: "Cần làm"
        urgent: task.priority === 'Cao',
        facility: user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id,
        createdAt: new Date().toISOString().split('T')[0]
      }));

      // Cập nhật State & Lưu trữ: Nối (Concat) mảng task mới
      onConfirm(mappedTasks);
      
      // Ghi đè mảng mới xuống localStorage
      const existingTasks = JSON.parse(localStorage.getItem('kanban_tasks') || '[]');
      const newTasks = [...existingTasks, ...mappedTasks];
      localStorage.setItem('kanban_tasks', JSON.stringify(newTasks));

      // Dọn dẹp
      setText('');
      onClose();
    } catch (error) {
      console.error('AI Error:', error);
      alert('AI không thể xử lý đoạn văn bản này, vui lòng thử lại.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-3xl rounded-2xl shadow-2xl border border-outline-variant dark:border-gray-800 flex flex-col max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-gradient-to-r from-secondary/10 to-transparent">
          <h2 className="text-xl font-bold text-on-surface dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary dark:text-purple-400">auto_awesome</span>
            Tạo Task từ Biên bản (AI)
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">Dán nội dung biên bản họp hoặc chỉ thị vào đây. AI sẽ tự động phân tích và bóc tách thành các công việc cụ thể.</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} className="w-full h-48 px-4 py-3 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-secondary/50 outline-none transition-all dark:text-white resize-none" placeholder="VD: Hôm nay họp bàn giao, yêu cầu anh A thay đèn LED phòng VIP 3 trước ngày mai. Khu vực sảnh cần kiểm tra vệ sinh gấp..."></textarea>
            <button onClick={handleAnalyze} disabled={!text.trim() || isAnalyzing} className="w-full bg-secondary hover:bg-secondary/90 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all shadow-md shadow-secondary/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {isAnalyzing ? (
                <><span className="material-symbols-outlined animate-spin">sync</span> AI đang xử lý...</>
              ) : (
                <><span className="material-symbols-outlined">insights</span> Trích xuất</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
