import React, { useState, useEffect } from 'react';

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

        if (!apiKey.trim().startsWith('sk-or-v1-')) {
          if (showToast) showToast(`❌ Lỗi: Key không hợp lệ! (Bạn đang gửi: "${apiKey.trim().substring(0, 15)}..."). Vui lòng copy đúng key từ OpenRouter.`);
          return;
        }

        setIsTesting(true);
        try {
          const rawBase = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL?.replace(/^["']|["']$/g, '').trim() || '';
          const baseURL = rawBase || 'https://taskflow-ai-dashboard.onrender.com';
          
          const response = await fetch(`${baseURL}/api/ai/test-key`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('taskflow_token') || ''}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              apiKey: apiKey.trim(),
              model: aiModel.trim()
            })
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errDetails = errData?.message || response.statusText || 'Unknown error';
            if (showToast) showToast(`❌ ${errDetails}`);
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
        const fetchConfig = async () => {
            try {
                let rawBase = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL?.replace(/^["']|["']$/g, '').trim() || '';
                if (rawBase && !rawBase.startsWith('http')) rawBase = 'https://' + rawBase;
                const baseURL = rawBase || 'https://taskflow-ai-dashboard.onrender.com';
                const configEndpoint = new URL('/api/config', baseURL).toString();
                
                const response = await fetch(configEndpoint, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('taskflow_token') || ''}` }
                });
                
                if (response.ok) {
                    const resData = await response.json();
                    if (resData.success && resData.data) {
                        const aiConfig = typeof resData.data.taskflow_ai_config === 'string' 
                            ? JSON.parse(resData.data.taskflow_ai_config) 
                            : (resData.data.taskflow_ai_config || {});
                        const sysPrompts = typeof resData.data.taskflow_system_prompts === 'string' 
                            ? JSON.parse(resData.data.taskflow_system_prompts) 
                            : (resData.data.taskflow_system_prompts || null);
                        
                        if (aiConfig.apiKey) setApiKey(aiConfig.apiKey);
                        if (aiConfig.aiModel) setAiModel(aiConfig.aiModel);
                        if (aiConfig.webhookUrl) setWebhookUrl(aiConfig.webhookUrl);
                        if (sysPrompts) setPrompts({ ...DEFAULT_PROMPTS, ...sysPrompts });
                    }
                }
            } catch (err) {
                console.error("Lỗi tải cấu hình từ server:", err);
            }
        };
        fetchConfig();
      }, []);

      const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        const cleanModel = aiModel.trim();
        setAiModel(cleanModel);
        
        const aiConfigPayload = { apiKey: apiKey.trim(), aiModel: cleanModel, webhookUrl };

        const finalPrompts = {
          autoTask: prompts.autoTask?.trim() || DEFAULT_PROMPTS.autoTask,
          empatheticPing: prompts.empatheticPing?.trim() || DEFAULT_PROMPTS.empatheticPing,
          advisorReport: prompts.advisorReport?.trim() || DEFAULT_PROMPTS.advisorReport
        };
        setPrompts(finalPrompts);

        try {
            let rawBase = import.meta.env.VITE_API_BASE_URL?.replace(/^["']|["']$/g, '').trim() || '';
            if (rawBase && !rawBase.startsWith('http')) rawBase = 'https://' + rawBase;
            const baseURL = rawBase || window.location.origin;
            const configEndpoint = new URL('/api/config', baseURL).toString();

            const response = await fetch(configEndpoint, {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('taskflow_token') || ''}`
              },
              body: JSON.stringify({ 
                ai_config: aiConfigPayload, 
                system_prompts: finalPrompts 
              })
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(()=>({}));
                throw new Error(errData.error || 'Lỗi lưu cấu hình');
            }
        } catch (err) {
           console.error("Lỗi đồng bộ cấu hình AI:", err);
           if (showToast) showToast(`❌ Lỗi đồng bộ: ${err.message}`);
           setIsSaving(false);
           return;
        }

        setIsSaving(false);
        if (showToast) showToast('✅ Lưu cấu hình và System Prompts thành công!');
        console.log('[SYSTEM] Reloading AI Instance with new config...');
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
              <input required type="text" autoComplete="off" placeholder="sk-or-v1-..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full px-4 py-3 bg-surface-container dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary dark:text-white transition-colors" />
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
