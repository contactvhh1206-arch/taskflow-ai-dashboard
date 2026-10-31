// Tính số liệu cho phần tóm tắt biểu đồ ở Tổng quan doanh thu. Hàm thuần, không gọi API.
// Doanh thu lấy từ daily_financial_reports (có từ 05/2026, khớp Heatmap); chi phí, số vé, khuyến mãi
// lấy từ dữ liệu file tổng nên chỉ có ở tháng đã nhập file.

const pad = (n) => String(n).padStart(2, '0');
export const facilityCode = (name) => String(name || '').toUpperCase().replace(/^DUBAI\s*/, '').trim();

export const previousMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

// Đọc KPI ngày theo cơ sở từ localStorage giống HeatmapKPI (chuỗi có thể bị JSON.stringify nhiều lớp)
export const readFacilityKpis = () => {
  let parsed = null;
  try { parsed = localStorage.getItem('taskflow_facility_kpis'); } catch { return {}; }
  let depth = 0;
  while (typeof parsed === 'string' && depth < 5) {
    try { parsed = JSON.parse(parsed); depth++; } catch { return {}; }
  }
  const out = {};
  if (parsed && typeof parsed === 'object') {
    for (const k of Object.values(parsed)) {
      if (k && k.name) out[facilityCode(k.name)] = k;
    }
  }
  return out;
};

const reportRows = (r) => {
  const rows = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  return Array.isArray(rows) ? rows : [];
};

// Tổng doanh thu theo ngày trong tháng { 1: {code: tiền} }
const revenueByDay = (reports, month) => {
  const days = {};
  for (const r of reports) {
    if (!String(r.date).startsWith(month)) continue;
    const day = Number(String(r.date).slice(8, 10));
    const d = (days[day] = days[day] || {});
    for (const f of reportRows(r)) {
      const code = facilityCode(f.name);
      d[code] = (d[code] || 0) + Number(f.revenue || 0);
    }
  }
  return days;
};

const sumValues = (o, inScope) => Object.entries(o || {}).reduce((a, [k, v]) => (inScope(k) ? a + v : a), 0);

export function buildRevenueSummary({ month, reports, finance, prevFinance, config, prevConfig, facilityList, kpis = {}, selectedFacility = null }) {
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const codes = (facilityList || []).map(f => facilityCode(f.name));
  const inScope = (code) => (selectedFacility ? code === selectedFacility : codes.includes(code));
  const serviceSet = (cfg) => new Set((cfg?.prices || []).filter(p => p.kind === 'service').map(p => p.ticket_type));
  const isTicket = (t, services) => t.ticket_type && !services.has(t.ticket_type);

  const curByDay = revenueByDay(reports, month);
  const prevByDay = revenueByDay(reports, previousMonth(month));

  // Ngày cuối đã có số (của cơ sở đang xem): so với tháng trước chỉ tới đúng ngày này, tránh so tháng dở với cả tháng
  let lastDay = 0;
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const revenue = sumValues(curByDay[d], inScope);
    if (revenue > 0) lastDay = d;
    const dow = new Date(year, mon - 1, d).getDay();
    const isWeekend = dow === 5 || dow === 6; // T6, T7 — giống HeatmapKPI
    let target = 0;
    for (const code of codes) {
      if (!inScope(code) || !kpis[code]) continue;
      target += Number(isWeekend ? kpis[code].weekend_target : kpis[code].weekday_target) || 0;
    }
    days.push({ day: d, date: `${pad(d)}/${pad(mon)}`, isWeekend, revenue, target });
  }

  const sumMonth = (byDay, untilDay) => {
    let total = 0;
    for (const [d, v] of Object.entries(byDay)) {
      if (Number(d) <= untilDay) total += sumValues(v, inScope);
    }
    return total;
  };

  const financeTotals = (fin, cfg, untilDay) => {
    if (!fin || !fin.daily?.length) return null;
    const services = serviceSet(cfg);
    const within = (r) => inScope(r.facility_code) && Number(r.date.slice(8, 10)) <= untilDay;
    return {
      expense: fin.daily.filter(within).reduce((a, r) => a + r.expense, 0),
      tickets: fin.tickets.filter(t => within(t) && isTicket(t, services)).reduce((a, t) => a + t.ticket_count, 0),
    };
  };

  const hasFinance = Boolean(finance?.daily?.length);
  const revenue = sumMonth(curByDay, daysInMonth);
  const prevRevenue = sumMonth(prevByDay, lastDay);
  const cur = financeTotals(finance, config, daysInMonth);
  const prev = financeTotals(prevFinance, prevConfig, lastDay);

  const totals = {
    revenue,
    prevRevenue: prevRevenue || null,
    expense: cur ? cur.expense : null,
    prevExpense: prev ? prev.expense : null,
    profit: cur ? revenue - cur.expense : null,
    prevProfit: prev && prevRevenue ? prevRevenue - prev.expense : null,
    tickets: cur ? cur.tickets : null,
    prevTickets: prev ? prev.tickets : null,
  };

  // Theo cơ sở (luôn đủ các cơ sở, không phụ thuộc cơ sở đang chọn)
  const facilityMap = {};
  for (const code of codes) facilityMap[code] = { code, revenue: 0, expense: 0, profit: null };
  for (const v of Object.values(curByDay)) {
    for (const [code, amount] of Object.entries(v)) {
      if (facilityMap[code]) facilityMap[code].revenue += amount;
    }
  }
  if (hasFinance) {
    for (const r of finance.daily) {
      if (facilityMap[r.facility_code]) facilityMap[r.facility_code].expense += r.expense;
    }
    for (const f of Object.values(facilityMap)) f.profit = f.revenue - f.expense;
  }
  const facilities = Object.values(facilityMap).sort((a, b) => b.revenue - a.revenue);

  // Chi phí: 5 nhóm lớn nhất, còn lại gộp
  let expenseGroups = [];
  if (hasFinance) {
    const cats = {};
    for (const e of finance.expenses) {
      if (!inScope(e.facility_code)) continue;
      const k = e.category || '(không ghi loại)';
      cats[k] = (cats[k] || 0) + e.amount;
    }
    const sorted = Object.entries(cats).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    expenseGroups = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((a, x) => a + x.total, 0);
    if (rest > 0) expenseGroups.push({ name: `Các nhóm còn lại (${sorted.length - 5})`, total: rest, isRest: true });
  }

  // Tỷ lệ vé khuyến mãi theo cơ sở. HH là kênh môi giới, không tính là khuyến mãi.
  let promo = [];
  if (hasFinance) {
    const services = serviceSet(config);
    const map = {};
    for (const code of codes) map[code] = { code, tickets: 0, promoTickets: 0 };
    for (const t of finance.tickets) {
      if (!map[t.facility_code] || !isTicket(t, services)) continue;
      map[t.facility_code].tickets += t.ticket_count;
      if (t.promo_code || ['percent', 'amount', 'combo'].includes(t.km_kind)) map[t.facility_code].promoTickets += t.ticket_count;
    }
    promo = Object.values(map)
      .map(x => ({ ...x, rate: x.tickets ? x.promoTickets / x.tickets : 0 }))
      .filter(x => x.tickets > 0)
      .sort((a, b) => b.rate - a.rate);
  }

  return { lastDay, daysInMonth, days, totals, facilities, expenseGroups, promo, hasFinance, hasPrevFinance: Boolean(prev) };
}
