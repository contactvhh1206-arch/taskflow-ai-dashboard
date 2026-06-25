import axiosClient from '../api/axiosClient';

export const saveData = async ({ org_unit, entry_type, content, attachments = [], aiVectorData = '' }) => {
  const now = new Date();
  const displayTime = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  // Ca làm việc 9h sáng đến 3h khuya hôm sau — nếu giờ < 6h sáng thì vẫn thuộc ngày hôm trước
  const workDay = new Date(now);
  if (now.getHours() < 6) workDay.setDate(workDay.getDate() - 1);
  const date = `${workDay.getDate().toString().padStart(2, '0')}/${(workDay.getMonth() + 1).toString().padStart(2, '0')}/${workDay.getFullYear()}`;

  try {
    const result = await axiosClient.post('/api/logs', {
        org_unit,
        entry_type,
        content,
        attachments,
        ai_vector_data: aiVectorData,
        date,
        display_time: displayTime
    });
    
    if (result.success) {
      return { ...result.data, displayTime: result.data.display_time, aiVectorData: result.data.ai_vector_data };
    }
  } catch (error) {
    console.error('Lỗi khi lưu data:', error);
  }
  return null;
};

export const updateData = async (id, { content, attachments = [], aiVectorData = '', edit_history = [] }) => {
  const now = new Date();
  const displayTime = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  try {
    const result = await axiosClient.put(`/api/logs/${id}`, {
        content,
        attachments,
        ai_vector_data: aiVectorData,
        display_time: displayTime,
        edit_history
    });
    
    if (result.success) {
      return { ...result.data, displayTime: result.data.display_time, aiVectorData: result.data.ai_vector_data };
    }
  } catch (error) {
    console.error('Lỗi khi cập nhật data:', error);
  }
  return null;
};

export const fetchHistory = async (filters = {}) => {
  try {
    const query = new URLSearchParams(filters).toString();
    const result = await axiosClient.get(`/api/logs?${query}`);
    if (result.success) {
      let filtered = result.data.map(item => ({
        ...item,
        displayTime: item.display_time,
        aiVectorData: item.ai_vector_data,
        editHistory: item.edit_history || []
      }));
      
      // Keep client-side fallback just in case backend doesn't filter perfectly yet
      if (filters.org_unit) filtered = filtered.filter(item => String(item.org_unit) === String(filters.org_unit));
      if (filters.entry_type) filtered = filtered.filter(item => item.entry_type === filters.entry_type);
      if (filters.date) filtered = filtered.filter(item => item.date === filters.date);
      
      return filtered;
    }
  } catch (error) {
    console.error('Lỗi khi fetch data:', error);
  }
  return [];
};

export const fetchAiSessions = async () => {
  try {
    const result = await axiosClient.get('/api/ai/sessions');
    if (result.success) return result.data;
    if (Array.isArray(result)) return result;
  } catch (error) {
    console.error('Lỗi fetch ai sessions:', error);
  }
  return [];
};

export const saveAiSession = async (sessionData) => {
  try {
    await axiosClient.post('/api/ai/sessions', sessionData);
  } catch (error) {
    console.error('Lỗi save ai session:', error);
  }
};

export const fetchReports = async () => {
  try {
    const result = await axiosClient.get('/api/reports');
    if (result.success) return result.data;
  } catch (error) {
    console.error('Lỗi lấy báo cáo doanh thu:', error);
  }
  return [];
};

export const saveReport = async (reportData) => {
  try {
    const result = await axiosClient.post('/api/reports', reportData);
    return result.success;
  } catch (error) {
    console.error('Lỗi lưu báo cáo doanh thu:', error);
    return false;
  }
};


export const streamAIChat = async (message, sessionId, token, onChunk, onDone, onError) => {
    try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com'}/api/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Bắt buộc truyền Token JWT từ Context
            },
            body: JSON.stringify({ message, session_id: sessionId })
        });

        if (!response.ok) throw new Error("Lỗi kết nối hệ thống AI.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (onDone) onDone();
                break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Giữ lại phần lỡ dở cho lần lặp sau
            
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const parsed = JSON.parse(line.substring(6));
                        if (parsed.content && onChunk) {
                            onChunk(parsed.content); // Bắn chữ về UI
                        } else if (parsed.error && onError) {
                            onError(parsed.error);
                        }
                    } catch (e) {
                        // Bỏ qua lỗi parse dở dang của luồng Stream
                    }
                }
            }
        }
    } catch (error) {
        console.error("Lỗi streamAIChat:", error);
        if (onError) onError(error);
    }
};
