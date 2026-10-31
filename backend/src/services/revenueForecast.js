// Dự đoán doanh thu: hàm thuần, không đọc DB, không dùng AI, cùng dữ liệu luôn ra cùng kết quả.
// Tháng sau = TB/ngày 3 tháng gần nhất × số ngày × hệ số mùa (41, ACE, PA năm trước).
// Tháng đang chạy = TB/ngày đã có × số ngày của tháng.
// Ngày chưa có số không tính là 0 đồng. Ngày Tết được quy về ngày thường trước khi lấy trung bình.

const CORE_FACILITIES = ['41', 'ACE', 'PA']; // Đủ dữ liệu từ 01/2025; PQ, PAK, PAV mở trong năm 2025
const TET_DATES = ['2025-01-29', '2026-02-17', '2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03'];
const TET_BEFORE = 7;
const TET_AFTER = 10;
const TET_WEIGHT = 0.77; // Đo được −23,5% (2025) và −23,3% (2026) trong đợt 18 ngày
const FULL_MONTH_MIN_DAYS = 20;
const NOWCAST_MIN_DAYS = 5;
const SHORT_TICKETS_MIN_DAYS = 3; // Còn ít ngày hơn thì số vé thiếu/ngày phóng đại, không có ý nghĩa
const DEFAULT_FLAT_BAND_PCT = 3;

// Khoảng dao động lấy từ sai số đo trên T01/2025–T10/2026 (tháng sau: 6/7 tháng thử nằm trong ±6%)
const NEXT_BAND = { chain: 6, facility: 15 };
const NEXT_BAND_TET = { chain: 10, facility: 20 }; // Chưa kiểm chứng được, nên để rộng hơn
const NOWCAST_BANDS = [ // Sai số P90 theo số ngày đã có
    { fromDay: 25, chain: 2, facility: 5 },
    { fromDay: 20, chain: 3, facility: 7 },
    { fromDay: 15, chain: 7, facility: 12 },
    { fromDay: 10, chain: 10, facility: 17 },
    { fromDay: 5, chain: 15, facility: 24 },
];

// Thử trên 74 tuần: mức 15% báo tới 38 tuần (quá nhiều), mức 20% báo 19 tuần
const WARNING_DROP_PCT = 20;

const DAY_MS = 86400000;
const toUtc = (date) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const monthOf = (date) => date.slice(0, 7);
const pad = (n) => String(n).padStart(2, '0');

const addMonths = (month, n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const lastYear = (month) => addMonths(month, -12);
const daysInMonth = (month) => {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const datesOfMonth = (month) => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);

const TET_RANGES = TET_DATES.map(d => [toUtc(d) - TET_BEFORE * DAY_MS, toUtc(d) + TET_AFTER * DAY_MS]);
const isTetDay = (date) => {
    const t = toUtc(date);
    return TET_RANGES.some(([a, b]) => t >= a && t <= b);
};
const dayWeight = (date) => (isTetDay(date) ? TET_WEIGHT : 1);
const monthHasTet = (month) => datesOfMonth(month).some(isTetDay);
const monthWeight = (month) => datesOfMonth(month).reduce((a, d) => a + dayWeight(d), 0);

const roundPct = (x) => Math.round(x * 10) / 10;
const pct = (value, base) => (base ? roundPct((value / base - 1) * 100) : null);

const classify = (yoyPct, flatBandPct) => {
    if (yoyPct === null) return null;
    if (yoyPct > flatBandPct) return 'up';
    if (yoyPct < -flatBandPct) return 'down';
    return 'flat';
};

// { facility: { date: { revenue, tickets } } }, bỏ các ngày 0 đồng (ngày chưa có số)
const indexRows = (rows) => {
    const byFacility = {};
    for (const r of rows) {
        const revenue = Number(r.revenue) || 0;
        if (revenue <= 0) continue;
        const f = (byFacility[r.facility_code] = byFacility[r.facility_code] || {});
        f[r.date] = { revenue, tickets: Number(r.tickets) || 0 };
    }
    return byFacility;
};

const monthDays = (series, month) => Object.keys(series || {}).filter(d => monthOf(d) === month).sort();
const monthRevenue = (series, month) => monthDays(series, month).reduce((a, d) => a + series[d].revenue, 0);
const isFullMonth = (series, month) => monthDays(series, month).length >= FULL_MONTH_MIN_DAYS;

// TB/ngày đã quy Tết về ngày thường
const normalPerDay = (series, days) =>
    (days.length ? days.reduce((a, d) => a + series[d].revenue / dayWeight(d), 0) / days.length : null);

const baseMonths = (byFacility, targetMonth) => {
    const months = new Set();
    for (const series of Object.values(byFacility)) {
        for (const d of Object.keys(series)) {
            if (monthOf(d) < targetMonth) months.add(monthOf(d));
        }
    }
    return [...months]
        .filter(m => Object.values(byFacility).some(s => isFullMonth(s, m)))
        .sort()
        .slice(-3);
};

const seasonalFactor = (byFacility, targetMonth, window) => {
    const corePerDay = (month) => {
        let sum = 0;
        for (const code of CORE_FACILITIES) {
            const s = byFacility[code];
            if (!s || !isFullMonth(s, month)) return null;
            sum += normalPerDay(s, monthDays(s, month));
        }
        return sum;
    };
    const target = corePerDay(lastYear(targetMonth));
    const bases = window.map(m => corePerDay(lastYear(m)));
    if (target === null || !bases.length || bases.some(b => b === null)) return null;
    return target / (bases.reduce((a, b) => a + b, 0) / bases.length);
};

const avgTicket = (series, window) => {
    let revenue = 0;
    let tickets = 0;
    for (const m of window) {
        for (const d of monthDays(series, m)) {
            if (series[d].tickets > 0) {
                revenue += series[d].revenue;
                tickets += series[d].tickets;
            }
        }
    }
    return tickets ? revenue / tickets : null;
};

const projectMonth = (series, month, window, factor) => {
    const usable = window.filter(m => isFullMonth(series, m));
    if (!usable.length) return null;
    const base = usable.reduce((a, m) => a + normalPerDay(series, monthDays(series, m)), 0) / usable.length;
    return base * monthWeight(month) * (factor === null ? 1 : factor);
};

const forecastFacility = (code, series, month, ctx) => {
    const { window, factor, flatBandPct } = ctx;
    const days = monthDays(series, month);
    const done = monthRevenue(series, month);
    const useActual = days.length >= NOWCAST_MIN_DAYS;
    const forecast = useActual
        ? normalPerDay(series, days) * monthWeight(month)
        : projectMonth(series, month, window, factor);
    const total = daysInMonth(month);
    const remaining = total - days.length;
    const lyMonth = lastYear(month);
    const ly = isFullMonth(series, lyMonth) ? monthRevenue(series, lyMonth) : null;
    const yoyPct = forecast !== null && ly !== null ? pct(forecast, ly) : null;
    const ticketPrice = avgTicket(series, window);

    let needPerDay = null;
    let shortTicketsPerDay = null;
    if (ly !== null && remaining > 0) {
        needPerDay = Math.max(0, (ly - done) / remaining);
        if (forecast !== null && ticketPrice && remaining >= SHORT_TICKETS_MIN_DAYS) {
            shortTicketsPerDay = Math.max(0, (ly - forecast) / remaining / ticketPrice);
        }
    }

    // Đếm từ đầu tháng tới ngày có số cuối cùng của cơ sở
    let missingDates = [];
    if (days.length) {
        const known = new Set(days);
        missingDates = datesOfMonth(month).filter(d => d < days[days.length - 1] && !known.has(d));
    }

    return {
        facility: code,
        method: useActual ? 'actual_run_rate' : 'seasonal',
        forecast,
        done,
        daysWithData: days.length,
        lastDataDate: days[days.length - 1] || null,
        missingDates,
        lastYear: ly,
        yoyPct,
        trend: classify(yoyPct, flatBandPct),
        needPerDay,
        shortTicketsPerDay,
        ticketPrice,
    };
};

const bandFor = (row, month, scope) => {
    if (row.method === 'actual_run_rate') {
        return NOWCAST_BANDS.find(b => row.daysWithData >= b.fromDay)[scope];
    }
    return (monthHasTet(month) ? NEXT_BAND_TET : NEXT_BAND)[scope];
};

const withBand = (row, month, scope) => {
    if (row.forecast === null) return { ...row, bandPct: null, low: null, high: null };
    const bandPct = bandFor(row, month, scope);
    return { ...row, bandPct, low: row.forecast * (1 - bandPct / 100), high: row.forecast * (1 + bandPct / 100) };
};

// Toàn chuỗi = cộng các cơ sở. Chỉ so với năm trước trên các cơ sở có đủ số cả hai năm.
const chainRow = (rows, month, flatBandPct) => {
    const valid = rows.filter(r => r.forecast !== null);
    const comparable = valid.filter(r => r.lastYear !== null);
    const sum = (arr, k) => arr.reduce((a, r) => a + (r[k] || 0), 0);
    const forecastComparable = sum(comparable, 'forecast');
    const ly = comparable.length ? sum(comparable, 'lastYear') : null;
    const yoyPct = ly !== null ? pct(forecastComparable, ly) : null;
    const minDays = valid.length ? Math.min(...valid.map(r => r.daysWithData)) : 0;
    const remaining = daysInMonth(month) - minDays;
    const method = valid.length && valid.every(r => r.method === 'actual_run_rate') ? 'actual_run_rate' : 'seasonal';
    // Tính trên tổng chuỗi, không cộng từng cơ sở: cơ sở vượt bù được cho cơ sở thiếu
    const priced = comparable.filter(r => r.ticketPrice);
    const chainTickets = priced.reduce((a, r) => a + r.forecast / r.ticketPrice, 0);
    const chainPrice = chainTickets ? sum(priced, 'forecast') / chainTickets : null;
    const shortTicketsPerDay = ly !== null && chainPrice && remaining >= SHORT_TICKETS_MIN_DAYS
        ? Math.max(0, (ly - forecastComparable) / remaining / chainPrice)
        : null;
    return {
        facility: 'ALL',
        method,
        forecast: valid.length ? sum(valid, 'forecast') : null,
        done: sum(rows, 'done'),
        daysWithData: minDays,
        lastDataDate: rows.map(r => r.lastDataDate).filter(Boolean).sort().pop() || null,
        missingDates: [],
        lastYear: ly,
        yoyPct,
        trend: classify(yoyPct, flatBandPct),
        needPerDay: ly !== null && remaining > 0 ? Math.max(0, (ly - sum(comparable, 'done')) / remaining) : null,
        shortTicketsPerDay,
        comparedFacilities: comparable.map(r => r.facility),
        excludedFromComparison: valid.filter(r => r.lastYear === null).map(r => r.facility),
    };
};

const forecastMonth = (byFacility, month, flatBandPct) => {
    const window = baseMonths(byFacility, month);
    const factor = seasonalFactor(byFacility, month, window);
    const ctx = { window, factor, flatBandPct };
    const raw = Object.keys(byFacility).sort().map(code => forecastFacility(code, byFacility[code], month, ctx));
    return {
        month,
        daysInMonth: daysInMonth(month),
        hasTet: monthHasTet(month),
        baseMonths: window,
        seasonalFactor: factor,
        chain: withBand(chainRow(raw, month, flatBandPct), month, 'chain'),
        facilities: raw.map(r => withBand(r, month, 'facility')),
    };
};

// 7 ngày gần nhất so với TB 7 ngày của 4 tuần trước đó; phải đủ số và không vướng Tết
const earlyWarnings = (byFacility, dropPct) => {
    const out = [];
    for (const [code, series] of Object.entries(byFacility)) {
        const dates = Object.keys(series).sort();
        if (!dates.length) continue;
        const last = toUtc(dates[dates.length - 1]);
        const range = (fromBack, n) => Array.from({ length: n }, (_, i) => fromUtc(last - (fromBack + i) * DAY_MS));
        const recent = range(0, 7);
        const before = range(7, 28);
        if ([...recent, ...before].some(d => isTetDay(d) || !series[d])) continue;
        const recentSum = recent.reduce((a, d) => a + series[d].revenue, 0);
        const beforeWeek = before.reduce((a, d) => a + series[d].revenue, 0) / 4;
        const changePct = pct(recentSum, beforeWeek);
        if (changePct !== null && changePct <= -dropPct) {
            out.push({ facility: code, lastDate: fromUtc(last), recentWeek: recentSum, previousWeekAvg: beforeWeek, changePct });
        }
    }
    return out;
};

// rows: [{ date: 'YYYY-MM-DD', facility_code, revenue, tickets? }]; today: 'YYYY-MM-DD' giờ Việt Nam
function buildRevenueForecast(rows, { today, flatBandPct = DEFAULT_FLAT_BAND_PCT, warningDropPct = WARNING_DROP_PCT } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today || '')) throw new Error('today phải có dạng YYYY-MM-DD');
    const known = indexRows((rows || []).filter(r => r.date <= today));
    const current = monthOf(today);
    const allDates = Object.values(known).flatMap(s => Object.keys(s)).sort();
    return {
        asOf: today,
        lastDataDate: allDates[allDates.length - 1] || null,
        flatBandPct,
        current: forecastMonth(known, current, flatBandPct),
        next: forecastMonth(known, addMonths(current, 1), flatBandPct),
        warnings: earlyWarnings(known, warningDropPct),
    };
}

// Chấm điểm: lấy bản dự đoán cuối cùng làm trước ngày đầu tháng, so với số thật của tháng đã hết
function scoreSnapshots(snapshots, rows, { today } = {}) {
    const byFacility = indexRows((rows || []).filter(r => r.date <= today));
    const currentMonth = monthOf(today);
    const latest = {};
    for (const s of snapshots || []) {
        if (s.target_month >= currentMonth || s.made_on >= `${s.target_month}-01`) continue;
        const key = `${s.target_month}|${s.facility_code}`;
        if (!latest[key] || s.made_on > latest[key].made_on) latest[key] = s;
    }
    const scored = [];
    for (const s of Object.values(latest)) {
        let actual = null;
        if (s.facility_code === 'ALL') {
            const list = Object.values(byFacility).filter(series => isFullMonth(series, s.target_month));
            if (list.length) actual = list.reduce((a, series) => a + monthRevenue(series, s.target_month), 0);
        } else if (byFacility[s.facility_code] && isFullMonth(byFacility[s.facility_code], s.target_month)) {
            actual = monthRevenue(byFacility[s.facility_code], s.target_month);
        }
        if (actual === null) continue;
        const forecast = Number(s.forecast);
        scored.push({
            month: s.target_month,
            facility: s.facility_code,
            madeOn: s.made_on,
            forecast,
            actual,
            errorPct: pct(forecast, actual),
            withinBand: actual >= Number(s.low) && actual <= Number(s.high),
        });
    }
    return scored.sort((a, b) => b.month.localeCompare(a.month) || a.facility.localeCompare(b.facility));
}

module.exports = {
    buildRevenueForecast,
    scoreSnapshots,
    isTetDay,
    DEFAULT_FLAT_BAND_PCT,
};
