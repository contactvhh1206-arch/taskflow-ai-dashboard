// Đưa cảnh báo sớm doanh thu vào chuông thông báo (lưu trong trình duyệt như các thông báo khác).
// Mỗi cơ sở báo tối đa một lần trong 7 ngày, để đợt tụt kéo dài không báo lại mỗi ngày.
import { fetchForecastWarnings } from '../services/dataService.js';

export const FORECAST_ALERT_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'];
const REPEAT_AFTER_DAYS = 7;
const DAY_MS = 86400000;

const shortDay = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const fmt = (v) => new Intl.NumberFormat('vi-VN').format(Math.round(v));
const fmtPct = (v) => String(v).replace('.', ',');
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY_MS;

// Hàm thuần: nhận cảnh báo và mốc đã báo, trả thông báo mới và mốc mới
export function collectForecastAlerts(warnings, notified, nowIso) {
  const nextNotified = { ...notified };
  const alerts = [];
  for (const w of warnings || []) {
    const last = notified[w.facility];
    if (last && daysBetween(last, w.lastDate) < REPEAT_AFTER_DAYS) continue;
    nextNotified[w.facility] = w.lastDate;
    alerts.push({
      id: `forecast_${w.facility}_${w.lastDate}`,
      targetTab: 'revenue-overview',
      title: `Cảnh báo doanh thu: ${w.facility}`,
      message: `7 ngày tới ${shortDay(w.lastDate)} đạt ${fmt(w.recentWeek)}, ${fmtPct(w.changePct)}% so với trung bình 4 tuần trước (${fmt(w.previousWeekAvg)}/tuần).`,
      time: shortDay(w.lastDate),
      timestamp: nowIso,
      read: false,
    });
  }
  return { alerts, nextNotified };
}

export async function syncForecastAlerts(username) {
  const warnings = await fetchForecastWarnings();
  const key = `taskflow_forecast_alerts_${username}`;
  let notified = {};
  try { notified = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* bỏ qua */ }
  const { alerts, nextNotified } = collectForecastAlerts(warnings, notified, new Date().toISOString());
  if (!alerts.length) return;
  let existing = [];
  try { existing = JSON.parse(localStorage.getItem('taskflow_notifications') || '[]'); } catch { /* bỏ qua */ }
  localStorage.setItem('taskflow_notifications', JSON.stringify([...existing, ...alerts]));
  localStorage.setItem(key, JSON.stringify(nextNotified));
  window.dispatchEvent(new Event('taskflow_notify'));
}
