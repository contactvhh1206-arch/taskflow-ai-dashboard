// Nguồn duy nhất cho API Base URL — tất cả fetch calls trong ứng dụng đều import từ đây
// Ưu tiên: VITE_API_URL (env) → fallback production URL
export const API_BASE = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';
