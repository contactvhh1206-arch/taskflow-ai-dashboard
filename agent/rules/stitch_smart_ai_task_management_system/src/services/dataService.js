const API_URL = 'https://taskflow-ai-dashboard.onrender.com/api/logs';

export const saveData = async ({ org_unit, entry_type, content, attachments = [], aiVectorData = '' }) => {
  const now = new Date();
  const displayTime = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('vi-VN');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_unit,
        entry_type,
        content,
        attachments,
        ai_vector_data: aiVectorData,
        date,
        display_time: displayTime
      })
    });
    
    if (!response.ok) throw new Error('Network response was not ok');
    const result = await response.json();
    if (result.success) {
      return { ...result.data, displayTime: result.data.display_time, aiVectorData: result.data.ai_vector_data };
    }
  } catch (error) {
    console.error('Lỗi khi lưu data:', error);
  }
  return null;
};

export const fetchHistory = async (filters = {}) => {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('Network response was not ok');
    const result = await response.json();
    if (result.success) {
      let filtered = result.data.map(item => ({
        ...item,
        displayTime: item.display_time,
        aiVectorData: item.ai_vector_data
      }));
      
      if (filters.org_unit) filtered = filtered.filter(item => item.org_unit === filters.org_unit);
      if (filters.entry_type) filtered = filtered.filter(item => item.entry_type === filters.entry_type);
      if (filters.date) filtered = filtered.filter(item => item.date === filters.date);
      
      return filtered;
    }
  } catch (error) {
    console.error('Lỗi khi fetch data:', error);
  }
  return [];
};

const REPORTS_API_URL = 'https://taskflow-ai-dashboard.onrender.com/api/reports';

export const fetchReports = async (token, role, facility_id) => {
  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (role) headers['x-user-role'] = role;
    if (facility_id) headers['x-facility-id'] = facility_id;

    const response = await fetch(REPORTS_API_URL, { headers });
    if (!response.ok) throw new Error('Failed to fetch reports');
    const result = await response.json();
    if (result.success) return result.data;
  } catch (error) {
    console.error('Lỗi lấy báo cáo doanh thu:', error);
  }
  return [];
};

export const saveReport = async (reportData, token, role, facility_id) => {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (role) headers['x-user-role'] = role;
    if (facility_id) headers['x-facility-id'] = facility_id;

    const response = await fetch(REPORTS_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(reportData)
    });
    if (!response.ok) throw new Error('Failed to save report');
    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error('Lỗi lưu báo cáo doanh thu:', error);
    return false;
  }
};
