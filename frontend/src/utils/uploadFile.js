const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';

/**
 * Upload file lên backend proxy (backend dùng service_role key → Supabase Storage)
 * Trả về publicUrl string, hoặc throw Error nếu thất bại
 */
export const uploadFile = async (file) => {
  const token = localStorage.getItem('taskflow_token');
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE_URL}/api/upload/attachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.message || 'Upload thất bại');
  return json.url;
};
