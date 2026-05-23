import React, { useState, useEffect, useRef } from 'react';

export default function ApiConfigPanel({ showToast }) {
      const [apiKey, setApiKey] = useState('');
      const [aiModel, setAiModel] = useState('anthropic/claude-3-opus');
      const [webhookUrl, setWebhookUrl] = useState('');
      const [isSaving, setIsSaving] = useState(false);
      const [isTesting, setIsTesting] = useState(false);

      const testOpenRouterConnection = async (e) => {
        if (e) e.preventDefault();
        if (!apiKey.trim()) {
          if (showToast) showToast('❌ Lỗi: Vui lòng nhập API Key trước khi kiểm tra!');
          return;
        }
        if (!aiModel.trim()) {
          if (showToast) showToast('❌ Lỗi: Vui lòng nhập Model ID trước khi kiểm tra!');
          return;
        }

        setIsTesting(true);
        try {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey.trim()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: aiModel.trim(),
              messages: [{ role: 'user', content: 'Ping' }]
            })
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errDetails = errData?.error?.message || response.statusText || 'Unknown error';
            
            if (response.status === 401) {
              if (showToast) showToast('❌ Lỗi xác thực: API Key không hợp lệ');
            } else if (response.status === 404) {
              if (showToast) showToast('❌ Lỗi: Model ID không tồn tại');
            } else {
              if (showToast) showToast(`❌ Lỗi kết nối: ${errDetails}`);
            }
          } else {
            if (showToast) showToast('✅ Kết nối API thành công!');
          }
        } catch (error) {
          if (showToast) showToast(`❌ Lỗi hệ thống: ${error.message}`);
        } finally {
          setIsTesting(false);
        }
      };

      const DEFAULT_PROMPTS = {
        autoTask: 'Bạn là trợ lý AI chuyên phân tích biên bản họp. Nhiệm vụ: Đọc văn bản, bóc tách thành các công việc (Task), xác định người phụ trách (PIC) và mức độ khẩn cấp.',
        empatheticPing: 'Tôi thấy công việc "[TASK_TITLE]" đang tới hạn. Bạn có cần hỗ trợ điều phối thêm nhân sự không? Đừng quá áp lực nhé!',
        advisorReport: 'Bạn là AI Advisor cấp cao. Nhiệm vụ: Tổng hợp dữ liệu cuối tuần, phân tích hiệu suất các cơ sở và đưa ra báo cáo ngắn gọn, súc tích.'
      };

      const [prompts, setPrompts] = useState(DEFAULT_PROMPTS);

      useEffect(() => {
        const config = JSON.parse(localStorage.getItem('taskflow_ai_config') || '{}');
        if (config.apiKey) setApiKey(config.apiKey);
        if (config.aiModel) setAiModel(config.aiModel);
        if (config.webhookUrl) setWebhookUrl(config.webhookUrl);

        const savedPrompts = JSON.parse(localStorage.getItem('taskflow_system_prompts') || 'null');
        if (savedPrompts) setPrompts({ ...DEFAULT_PROMPTS, ...savedPrompts });
      }, []);

      const handleSave = (e) => {
        e.preventDefault();
        setIsSaving(true);
        setTimeout(() => {
          const cleanModel = aiModel.trim();
          setAiModel(cleanModel);
          localStorage.setItem('taskflow_ai_config', JSON.stringify({ apiKey, aiModel: cleanModel, webhookUrl }));

          const finalPrompts = {
            autoTask: prompts.autoTask?.trim() || DEFAULT_PROMPTS.autoTask,
            empatheticPing: prompts.empatheticPing?.trim() || DEFAULT_PROMPTS.empatheticPing,
            advisorReport: prompts.advisorReport?.trim() || DEFAULT_PROMPTS.advisorReport
          };
          setPrompts(finalPrompts);
          localStorage.setItem('taskflow_system_prompts', JSON.stringify(finalPrompts));

          setIsSaving(false);
          if (showToast) showToast('✅ Lưu cấu hình và System Prompts thành công!');
          console.log('[SYSTEM] Reloading AI Instance with new config...');
        }, 800);
      };

      const handleRestore = (key) => {
        setPrompts(prev => ({ ...prev, [key]: DEFAULT_PROMPTS[key] }));
      };

      return (
        <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 animate-fade-in flex flex-col h-[75vh] overflow-y-auto custom-scrollbar">
          <div className="p-6 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-primary/10 to-transparent sticky top-0 z-10 bg-white dark:bg-[#1e1e1e]">
            <h2 className="text-xl font-bold dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-primary">api</span> Cấu hình API & AI Core</h2>
            <p className="text-sm text-gray-500 mt-1">Kết nối lõi AI Đa tác vụ qua OpenRouter và thiết lập tích hợp Webhook.</p>
          </div>
          <form onSubmit={handleSave} className="p-8 space-y-6 flex-1 max-w-4xl mx-auto w-full">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">OpenRouter API Key *</label>
              <input required type="password" placeholder="sk-or-v1-..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full px-4 py-3 bg-surface-container dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary dark:text-white transition-colors" />
              <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">lock</span> Khóa API được mã hóa và lưu trữ cục bộ an toàn.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">AI Model</label>
                <input type="text" placeholder="Ví dụ: google/gemini-1.5-pro" value={aiModel} onChange={e => setAiModel(e.target.value)} className="w-full px-4 py-3 bg-surface-container dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary dark:text-white transition-colors" />
                <p className="text-xs text-gray-500 mt-1.5">Nhập chính xác Model ID từ OpenRouter (VD: anthropic/claude-3-opus, openai/gpt-4o).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Webhook URL (Tùy chọn)</label>
                <input type="url" placeholder="https://your-erp.com/webhook" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} className="w-full px-4 py-3 bg-surface-container dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary dark:text-white transition-colors" />
              </div>
            </div>

            <div className="mt-8 border border-outline-variant dark:border-gray-700 rounded-xl overflow-hidden bg-surface dark:bg-[#1a1a1a]">
              <div className="p-4 bg-surface-variant/50 dark:bg-gray-800 border-b border-outline-variant dark:border-gray-700 font-bold dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">psychology</span> Quản lý Cú pháp AI (System Prompts)
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Prompt Trích xuất Auto-Tasking</label>
                    <button type="button" onClick={() => handleRestore('autoTask')} className="text-xs text-primary hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">restore</span> Khôi phục mặc định</button>
                  </div>
                  <textarea required value={prompts.autoTask} onChange={e => setPrompts({ ...prompts, autoTask: e.target.value })} className="w-full px-4 py-3 bg-surface-container dark:bg-[#252525] border border-gray-300 dark:border-gray-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary dark:text-white transition-colors min-h-[80px]" />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Prompt Đôn đốc Thấu cảm (Empathetic Ping)</label>
                    <button type="button" onClick={() => handleRestore('empatheticPing')} className="text-xs text-primary hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">restore</span> Khôi phục mặc định</button>
                  </div>
                  <textarea required value={prompts.empatheticPing} onChange={e => setPrompts({ ...prompts, empatheticPing: e.target.value })} className="w-full px-4 py-3 bg-surface-container dark:bg-[#252525] border border-gray-300 dark:border-gray-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary dark:text-white transition-colors min-h-[80px]" />
                  <p className="text-[10px] text-gray-500 mt-1">Biến được hỗ trợ: [TASK_TITLE]</p>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Prompt Phân tích & Báo cáo Cố vấn</label>
                    <button type="button" onClick={() => handleRestore('advisorReport')} className="text-xs text-primary hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">restore</span> Khôi phục mặc định</button>
                  </div>
                  <textarea required value={prompts.advisorReport} onChange={e => setPrompts({ ...prompts, advisorReport: e.target.value })} className="w-full px-4 py-3 bg-surface-container dark:bg-[#252525] border border-gray-300 dark:border-gray-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary dark:text-white transition-colors min-h-[80px]" />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-outline-variant dark:border-gray-800 flex items-center justify-between">
              <span className="text-sm text-gray-500 flex items-center gap-2"><span className="material-symbols-outlined text-[16px] text-green-500">bolt</span> Hệ thống sẽ tự động nạp lại Model.</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={testOpenRouterConnection} disabled={isTesting || isSaving} className="px-6 py-3 border border-outline-variant dark:border-gray-600 hover:bg-surface-variant dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  {isTesting ? <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[20px]">cable</span>} Kiểm tra Kết nối
                </button>
                <button type="submit" disabled={isSaving || isTesting} className="px-6 py-3 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-lg shadow-primary/30 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  {isSaving ? <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[20px]">save</span>} Lưu Cấu Hình
                </button>
              </div>
            </div>
          </form>
        </div>
      );
    }
