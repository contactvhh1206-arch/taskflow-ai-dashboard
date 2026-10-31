// Tách doanh thu theo nguồn khách từ cột Code và KM của file tổng. Hàm thuần, không đọc DB.
// Một dòng vé chỉ thuộc một nhóm, nên tổng các nhóm luôn bằng doanh thu của tháng.

const SOURCE_GROUPS = [
    { key: 'direct', label: 'Không mã, không giảm', note: 'Coi như khách tự đến; file không ghi rõ nguồn' },
    { key: 'commission', label: 'Môi giới hoa hồng', note: 'KM ghi HH' },
    { key: 'camapro', label: 'Camapro', note: 'Mã CM' },
    { key: 'manager', label: 'Quản lý cho giảm', note: 'Mã AT, AH, AP, QL' },
    { key: 'combo', label: 'Combo', note: 'KM hoặc mã CB' },
    { key: 'desk', label: 'Lễ tân tự giảm', note: 'KM âm, không mã' },
    { key: 'gift', label: 'Thẻ quà tặng', note: 'Mã VIP' },
    { key: 'maps', label: 'Google Maps', note: 'Mã GG' },
    { key: 'football', label: 'Bóng đá', note: 'Mã BD' },
    { key: 'other_code', label: 'Mã khác', note: 'Các mã còn lại' },
    { key: 'other_discount', label: 'Giảm không mã', note: 'Giảm % hoặc KM khác, không có mã' },
    { key: 'service', label: 'Dịch vụ', note: 'MS, LG; không tính là vé' },
    { key: 'surplus', label: 'Tiền dư', note: 'Dòng có tiền, không ghi loại vé' },
];
const NON_TICKET_GROUPS = new Set(['service', 'surplus']);
const FULL_MONTH_MIN_DAYS = 20;
// File tổng chỉ bắt đầu ghi HH từ 03/2026 (đủ từ 04/2026) và mã GG từ 03/2026. Trước đó vé môi giới vẫn có
// nhưng nằm trong "Không mã, không giảm", nên không so năm trước các nhóm này với tháng chưa ghi.
const MARKED_SINCE = { direct: '2026-04', commission: '2026-04', maps: '2026-03' };
const COMMISSION_MARKED_SINCE = MARKED_SINCE.commission;

// Bỏ dấu và khoảng trắng để "A TÙNG", "ATUNG", "GG MAP", "BĐ" khớp cùng một mã
const normalizeCode = (code) => String(code || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D')
    .replace(/\s+/g, '').toUpperCase();

const groupOfTicket = ({ ticket_type: type, promo_code: promo, km_kind: kind }, serviceTypes) => {
    if (!type) return 'surplus';
    if (serviceTypes.has(String(type).toUpperCase())) return 'service';
    if (kind === 'commission') return 'commission';
    const code = normalizeCode(promo);
    if (code) {
        if (/^CM\d*$/.test(code)) return 'camapro';
        if (/^VIP\d*$/.test(code)) return 'gift';
        if (/^GG(MAP)?\d*$/.test(code)) return 'maps';
        if (/^BD\d*$/.test(code)) return 'football';
        if (/^CB\d*$/.test(code)) return 'combo';
        if (/^(AT|AH|AP)\d*$/.test(code) || ['QL', 'ATUNG', 'AHUNG'].includes(code)) return 'manager';
        return 'other_code';
    }
    if (kind === 'amount') return 'desk';
    if (kind === 'combo') return 'combo';
    if (kind) return 'other_discount';
    return 'direct';
};

const previousYear = (month) => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;

const summarize = (rows, serviceTypes) => {
    const out = {};
    for (const r of rows) {
        const g = groupOfTicket(r, serviceTypes);
        const x = (out[g] = out[g] || { revenue: 0, tickets: 0 });
        x.revenue += Number(r.revenue) || 0;
        x.tickets += Number(r.ticket_count) || 0;
    }
    return out;
};

// So theo TB/ngày và chỉ trên cơ sở có đủ số cả hai năm, để tháng đang chạy và cơ sở mới không làm sai so sánh
const scopeResult = (facilities, ctx) => {
    const { rows, month, days, serviceTypes } = ctx;
    const lyMonth = previousYear(month);
    const dayOf = (m, f) => days[`${m}|${f}`] || 0;
    const inScope = (r, m) => r.month === m && facilities.includes(r.facility_code);
    const current = summarize(rows.filter(r => inScope(r, month)), serviceTypes);
    const totalRevenue = Object.values(current).reduce((a, x) => a + x.revenue, 0);

    const comparable = facilities.filter(f => dayOf(month, f) > 0 && dayOf(lyMonth, f) >= FULL_MONTH_MIN_DAYS);
    const perDay = (list, m) => {
        const totals = {};
        for (const f of list) {
            const s = summarize(rows.filter(r => r.month === m && r.facility_code === f), serviceTypes);
            for (const [g, x] of Object.entries(s)) totals[g] = (totals[g] || 0) + x.revenue / dayOf(m, f);
        }
        return totals;
    };
    const nowDaily = perDay(comparable, month);
    const lyDaily = perDay(comparable, lyMonth);

    const groups = SOURCE_GROUPS
        .filter(g => current[g.key])
        .map(g => {
            const c = current[g.key];
            const before = lyDaily[g.key];
            const now = nowDaily[g.key] || 0;
            return {
                key: g.key,
                label: g.label,
                note: g.note,
                revenue: c.revenue,
                tickets: NON_TICKET_GROUPS.has(g.key) ? null : c.tickets,
                avgTicket: !NON_TICKET_GROUPS.has(g.key) && c.tickets ? c.revenue / c.tickets : null,
                sharePct: totalRevenue ? Math.round((c.revenue / totalRevenue) * 1000) / 10 : 0,
                yoyPct: comparable.length && before > 0 && !(lyMonth < (MARKED_SINCE[g.key] || ''))
                    ? Math.round((now / before - 1) * 1000) / 10
                    : null,
            };
        })
        .sort((a, b) => b.revenue - a.revenue);

    return { totalRevenue, groups, comparedFacilities: comparable };
};

// rows: dòng vé gộp của tháng và cùng tháng năm trước; dayRows: { month, facility_code, days }
function buildRevenueSources(rows, dayRows, { month, serviceTypes = [] }) {
    const services = new Set(serviceTypes.map(s => String(s).toUpperCase()));
    const days = {};
    for (const d of dayRows) days[`${d.month}|${d.facility_code}`] = Number(d.days) || 0;
    const facilities = [...new Set(rows.filter(r => r.month === month).map(r => r.facility_code))].sort();
    const ctx = { rows, month, days, serviceTypes: services };
    const byFacility = {};
    for (const f of facilities) byFacility[f] = scopeResult([f], ctx);
    return {
        month,
        facilities,
        commissionNotMarked: month < COMMISSION_MARKED_SINCE,
        commissionNotComparable: previousYear(month) < COMMISSION_MARKED_SINCE,
        chain: scopeResult(facilities, ctx),
        byFacility,
    };
}

module.exports = { buildRevenueSources, groupOfTicket, normalizeCode, SOURCE_GROUPS };
