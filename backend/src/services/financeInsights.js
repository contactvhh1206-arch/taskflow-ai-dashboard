// Đọc số cho bộ dự đoán và viết các khối dữ liệu cho Cố vấn AI.
// Cố vấn AI chỉ đọc số code đã tính, không tự tính dự đoán hay cộng lại chi phí.
const pool = require('../config/database');
const { buildRevenueForecast, DEFAULT_FLAT_BAND_PCT } = require('./revenueForecast');

// Khớp quyền mở tab "Tổng quan doanh thu" ở frontend
const FINANCE_READ_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD'];
const FACILITY_CODES = new Set(['41', 'ACE', 'PQ', 'PA', 'PAV', 'PAK']);
const TABLE_MISSING = '42P01';
const MAX_EXPENSE_MONTHS = 4;
const TOP_EXPENSE_CATEGORIES = 8;

const vietnamToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const facilityCodeFromName = (name) => String(name || '').normalize('NFC').trim().toUpperCase().replace(/^DUBAI\s*/, '');

// File tổng là số chốt; ngày file chưa có thì lấy doanh thu kế toán nhập hằng ngày
const loadForecastRows = async (fromDate) => {
    const [finance, reports] = await Promise.all([
        pool.query(
            `SELECT to_char(date, 'YYYY-MM-DD') AS date, facility_code, ticket_revenue::float AS revenue, ticket_count AS tickets
             FROM finance_daily WHERE date >= $1::date`, [fromDate]),
        pool.query('SELECT date, data FROM daily_financial_reports WHERE date >= $1', [fromDate]),
    ]);
    const rows = new Map();
    for (const r of reports.rows) {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (!Array.isArray(data)) continue;
        for (const item of data) {
            const code = facilityCodeFromName(item.name);
            if (FACILITY_CODES.has(code)) {
                rows.set(`${r.date}|${code}`, { date: r.date, facility_code: code, revenue: Number(item.revenue) || 0, tickets: 0 });
            }
        }
    }
    for (const r of finance.rows) {
        if (FACILITY_CODES.has(r.facility_code)) rows.set(`${r.date}|${r.facility_code}`, r);
    }
    return [...rows.values()];
};

const loadFlatBand = async () => {
    try {
        const { rows } = await pool.query('SELECT flat_band_pct::float AS value FROM finance_forecast_settings WHERE id = 1');
        return rows[0] ? rows[0].value : DEFAULT_FLAT_BAND_PCT;
    } catch (e) {
        if (e.code === TABLE_MISSING) return DEFAULT_FLAT_BAND_PCT;
        throw e;
    }
};

// Cần 3 tháng nền + cùng kỳ năm trước của tháng sau; riêng chấm điểm đọc thêm tới 24 tháng
const computeForecast = async () => {
    const today = vietnamToday();
    const fromDate = `${Number(today.slice(0, 4)) - 2}-01-01`;
    const [rows, flatBandPct] = await Promise.all([loadForecastRows(fromDate), loadFlatBand()]);
    return { today, rows, forecast: buildRevenueForecast(rows, { today, flatBandPct }) };
};

// --- Nhận diện câu hỏi ---
const FORECAST_KEYWORDS = ['dự đoán', 'du doan', 'dự báo', 'du bao', 'tháng sau', 'thang sau', 'tháng tới', 'thang toi',
    'cuối tháng', 'cuoi thang', 'cảnh báo sớm', 'canh bao som', 'năm trước', 'nam truoc', 'năm ngoái', 'nam ngoai', 'cùng kỳ', 'cung ky',
    'xu hướng', 'xu huong', 'cơ sở nào tụt', 'co so nao tut', 'bị tụt', 'bi tut'];
const EXPENSE_KEYWORDS = ['chi phí', 'chi phi', 'lợi nhuận', 'loi nhuan', 'lời lãi', 'loi lai', 'tổng chi', 'tong chi', 'khoản chi', 'khoan chi',
    'hoa hồng', 'hoa hong', 'chi hằng ngày', 'trừ chi', 'tiền chi', 'chi bao nhiêu', 'chi tiêu', 'chi tieu'];
const detectForecastKeyword = (t) => FORECAST_KEYWORDS.some(k => t.includes(k));
const detectExpenseKeyword = (t) => EXPENSE_KEYWORDS.some(k => t.includes(k));
const canReadFinance = (role) => FINANCE_READ_ROLES.includes(role);

const pad = (n) => String(n).padStart(2, '0');
const previousMonth = (month) => {
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

// Các tháng được nhắc trong câu hỏi; không nhắc tháng nào thì dùng tháng mới nhất có số
const parseExpenseMonths = (text, today, latestMonth) => {
    const months = [];
    const add = (m) => { if (!months.includes(m)) months.push(m); };
    const years = [...new Set((text.match(/\b20\d{2}\b/g) || []))];
    const fallbackYear = years.length === 1 ? years[0] : today.slice(0, 4);
    for (const mt of text.matchAll(/th[áa]ng\s*(\d{1,2})(?:\s*[/-]\s*(\d{4}))?/g)) {
        const m = Number(mt[1]);
        if (m >= 1 && m <= 12) add(`${mt[2] || fallbackYear}-${pad(m)}`);
    }
    const current = today.slice(0, 7);
    if (['tháng này', 'thang nay', 'tháng hiện tại', 'trong tháng'].some(k => text.includes(k))) add(current);
    if (['tháng trước', 'thang truoc', 'tháng rồi', 'thang roi'].some(k => text.includes(k))) add(previousMonth(months[0] || current));
    if (!months.length && latestMonth) add(latestMonth);
    return months.slice(0, MAX_EXPENSE_MONTHS);
};

// --- Số chi ---
const loadLatestExpenseMonth = async () => {
    const { rows } = await pool.query('SELECT MAX(month) AS month FROM finance_daily');
    return rows[0]?.month || null;
};

const loadExpenseSummary = async (months) => {
    const [daily, items] = await Promise.all([
        pool.query(
            `SELECT month, facility_code, SUM(ticket_revenue)::float AS revenue, SUM(expense)::float AS expense,
                    to_char(MAX(date), 'YYYY-MM-DD') AS last_date
             FROM finance_daily WHERE month = ANY($1) GROUP BY month, facility_code`, [months]),
        pool.query(
            `SELECT month, facility_code, category, SUM(amount)::float AS amount
             FROM finance_expense_items WHERE month = ANY($1) GROUP BY month, facility_code, category`, [months]),
    ]);
    return { daily: daily.rows, items: items.rows };
};

// --- Viết khối dữ liệu ---
const fmt = (v) => (v === null || v === undefined ? 'không có' : Math.round(v).toLocaleString('vi-VN'));
const fmtPct = (v) => (v === null || v === undefined ? 'không có' : `${v > 0 ? '+' : ''}${v}%`);
const TREND_LABEL = { up: 'TĂNG', flat: 'BẰNG', down: 'GIẢM' };
const trendLabel = (t) => TREND_LABEL[t] || 'CHƯA SO ĐƯỢC (cơ sở chưa đủ 1 năm)';
const monthLabel = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

const formatMonthForecast = (m) => {
    const c = m.chain;
    const lines = [`### ${monthLabel(m.month)}${m.hasTet ? ' (có Tết, độ tin cậy thấp hơn)' : ''}`];
    lines.push(`Toàn chuỗi: dự đoán ${fmt(c.forecast)}, khoảng ${fmt(c.low)} đến ${fmt(c.high)}.`
        + ` Năm trước ${fmt(c.lastYear)}, ${fmtPct(c.yoyPct)}, nhận định ${trendLabel(c.trend)}.`
        + ` Để bằng năm trước cần ${fmt(c.needPerDay)}/ngày.`
        + (c.shortTicketsPerDay === null ? '' : ` Thiếu ${Math.ceil(c.shortTicketsPerDay)} vé/ngày so với dự đoán.`));
    if (c.excludedFromComparison.length) lines.push(`Không so với năm trước: ${c.excludedFromComparison.join(', ')}.`);
    lines.push('| Cơ sở | Đã có | Số ngày có số | Dự đoán | Năm trước | So năm trước | Nhận định | Cần/ngày | Thiếu vé/ngày |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of m.facilities) {
        lines.push(`| ${r.facility} | ${fmt(r.done)} | ${r.daysWithData} | ${fmt(r.forecast)} | ${fmt(r.lastYear)} | ${fmtPct(r.yoyPct)} | ${trendLabel(r.trend)} | ${fmt(r.needPerDay)} | ${r.shortTicketsPerDay === null ? 'không có' : Math.ceil(r.shortTicketsPerDay)} |`);
    }
    const missing = m.facilities.filter(r => r.missingDates.length);
    if (missing.length) lines.push(`Ngày chưa nhập số, không tính vào trung bình: ${missing.map(r => `${r.facility} (${r.missingDates.join(', ')})`).join('; ')}.`);
    return lines.join('\n');
};

const formatForecastBlock = (f) => {
    const lines = [
        `Số liệu có tới ${f.lastDataDate || 'không có'}. Mức "bằng" là lệch trong ±${f.flatBandPct}%. Từng cơ sở dao động nhiều hơn toàn chuỗi, chỉ nên đọc như hướng tham khảo.`,
        formatMonthForecast(f.current),
        formatMonthForecast(f.next),
        '### Cảnh báo sớm (7 ngày gần nhất so với trung bình 4 tuần trước)',
    ];
    if (f.warnings.length) {
        for (const w of f.warnings) {
            lines.push(`- ${w.facility}: 7 ngày tới ${w.lastDate} đạt ${fmt(w.recentWeek)}, ${fmtPct(w.changePct)} so với ${fmt(w.previousWeekAvg)}/tuần.`);
        }
    } else {
        lines.push('Không có cơ sở nào chạm ngưỡng cảnh báo.');
    }
    return lines.join('\n');
};

const formatExpenseBlock = (months, { daily, items }) => {
    const lines = ['Tên đúng là "doanh thu trừ chi phát sinh". Số này CHƯA gồm lương và mặt bằng nên KHÔNG phải lợi nhuận thật.'];
    for (const month of months) {
        const rows = daily.filter(r => r.month === month).sort((a, b) => b.revenue - a.revenue);
        lines.push(`### ${monthLabel(month)}`);
        if (!rows.length) {
            lines.push('Chưa có file tổng của tháng này trên Hub.');
            continue;
        }
        const revenue = rows.reduce((a, r) => a + r.revenue, 0);
        const expense = rows.reduce((a, r) => a + r.expense, 0);
        const last = rows.map(r => r.last_date).sort().pop();
        lines.push(`Có số tới ${last}. Toàn chuỗi: doanh thu ${fmt(revenue)}, chi phát sinh ${fmt(expense)}, doanh thu trừ chi ${fmt(revenue - expense)}.`);
        const monthItems = items.filter(i => i.month === month);
        const isCommission = (i) => /^hh/i.test(String(i.category || '').trim());
        lines.push('| Cơ sở | Doanh thu | Chi phát sinh | Hoa hồng dẫn khách | Doanh thu trừ chi |');
        lines.push('|---|---|---|---|---|');
        for (const r of rows) {
            const commission = monthItems.filter(i => i.facility_code === r.facility_code && isCommission(i)).reduce((a, i) => a + i.amount, 0);
            lines.push(`| ${r.facility_code} | ${fmt(r.revenue)} | ${fmt(r.expense)} | ${fmt(commission)} | ${fmt(r.revenue - r.expense)} |`);
        }
        // Gộp các loại chỉ khác chữ hoa/thường ("HH dẫn khách", "hH dẫn khách")
        const groups = new Map();
        for (const i of monthItems) {
            const name = String(i.category || '').trim() || '(không ghi loại)';
            const key = name.toLowerCase();
            const g = groups.get(key) || { name, amount: 0 };
            g.amount += i.amount;
            groups.set(key, g);
        }
        const sorted = [...groups.values()].sort((a, b) => b.amount - a.amount);
        const top = sorted.slice(0, TOP_EXPENSE_CATEGORIES);
        const rest = sorted.slice(TOP_EXPENSE_CATEGORIES).reduce((a, g) => a + g.amount, 0);
        lines.push(`Chi theo loại: ${top.map(g => `${g.name}: ${fmt(g.amount)}`).join('; ')}${rest ? `; các loại còn lại: ${fmt(rest)}` : ''}.`);
    }
    return lines.join('\n');
};

module.exports = {
    FINANCE_READ_ROLES,
    TABLE_MISSING,
    computeForecast,
    canReadFinance,
    detectForecastKeyword,
    detectExpenseKeyword,
    parseExpenseMonths,
    loadLatestExpenseMonth,
    loadExpenseSummary,
    formatForecastBlock,
    formatExpenseBlock,
};
