const DB_KEY = 'Company_Master_Logs';

export const saveData = ({ org_unit, entry_type, content, attachments = [], aiVectorData = '' }) => {
  const history = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
  const now = new Date();

  const newRecord = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
    timestamp: now.toISOString(),
    displayTime: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('vi-VN'),
    org_unit,
    entry_type,
    content,
    attachments,
    aiVectorData
  };

  const updatedHistory = [newRecord, ...history];
  localStorage.setItem(DB_KEY, JSON.stringify(updatedHistory));
  return newRecord;
};

export const fetchHistory = (filters = {}) => {
  const history = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
  let filtered = history;
  if (filters.org_unit) filtered = filtered.filter(item => item.org_unit === filters.org_unit);
  if (filters.entry_type) filtered = filtered.filter(item => item.entry_type === filters.entry_type);
  if (filters.date) filtered = filtered.filter(item => item.date === filters.date);
  return filtered;
};
