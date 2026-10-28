import React from 'react';
import { fetchFinanceConfig, fetchFinanceMonth, fetchFinanceMonths, saveFinanceConfig } from '../services/dataService.js';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '–');
const FAC_ORDER = ['41', 'ACE', 'PQ', 'PA', 'PAV', 'PAK'];
const sortFac = (a, b) => (FAC_ORDER.indexOf(a) + 1 || 99) - (FAC_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b);
const KM_KIND_LABEL = {
  percent: 'Giảm % (không mã)',
  amount: 'Trừ tiền (không mã)',
  combo: 'Combo (CB)',
  commission: 'Môi giới hoa hồng (HH)',
  other: 'KM khác (không mã)',
};

const Card = ({ title, children, right }) => (
  <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
    <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 flex-wrap">
      <h3 className="font-bold text-gray-900 dark:text-white">{title}</h3>
      {right}
    </div>
    <div className="p-4 overflow-x-auto custom-scrollbar">{children}</div>
  </div>
);

const Th = ({ children, left }) => (
  <th className={`px-3 py-2 font-bold whitespace-nowrap text-gray-600 dark:text-gray-300 ${left ? 'text-left' : 'text-right'}`}>{children}</th>
);
const Td = ({ children, left, className = '' }) => (
  <td className={`px-3 py-1.5 whitespace-nowrap ${left ? 'text-left' : 'text-right'} ${className}`}>{children}</td>
);

// Đối chiếu tài chính: dữ liệu từ file tổng tháng (vé theo loại, khuyến mãi, chi từng khoản, hàng bán kèm)
export default function FinanceReconciliation({ user }) {
  const canEdit = ['FINANCE_DEPT', 'SUPER_ADMIN'].includes(user?.role);
  const [months, setMonths] = React.useState([]);
  const [month, setMonth] = React.useState('');
  const [data, setData] = React.useState(null);
  const [config, setConfig] = React.useState({ prices: [], promoCodes: [] });
  const [facility, setFacility] = React.useState('ALL');
  const [expenseCategory, setExpenseCategory] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    (async () => {
      try {
        const [ms, cfg] = await Promise.all([fetchFinanceMonths(), fetchFinanceConfig()]);
        setMonths(ms);
        setConfig(cfg);
        setMonth(ms[0]?.month || new Date().toISOString().slice(0, 7));
      } catch (e) {
        setError(e.response?.data?.error || e.message);
        setLoading(false);
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!month) return;
    setLoading(true);
    fetchFinanceMonth(month)
      .then(d => { setData(d); setError(''); })
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [month]);

  const priceMap = React.useMemo(() => Object.fromEntries(config.prices
    .filter(p => p.kind !== 'service' && p.list_price !== null && p.list_price !== '')
    .map(p => [p.ticket_type, Number(p.list_price)])), [config]);
  const serviceName = React.useMemo(() => Object.fromEntries(config.prices
    .filter(p => p.kind === 'service').map(p => [p.ticket_type, p.name || p.ticket_type])), [config]);
  const codeName = React.useMemo(() => Object.fromEntries(config.promoCodes.map(c => [c.code, c.name])), [config]);

  const view = React.useMemo(() => {
    if (!data) return null;
    const inFac = (r) => facility === 'ALL' || r.facility_code === facility;
    const facilities = [...new Set(data.daily.map(d => d.facility_code))].sort(sortFac);
    const daily = data.daily.filter(inFac);
    // Vé thật vs dịch vụ (MS, LG...) vs tiền dư (dòng không ghi loại). Đếm vé/khách từ đây chứ không
    // từ finance_daily, để dữ liệu đã nhập trước khi có phân loại dịch vụ vẫn hiển thị đúng.
    const isTicket = (t) => t.ticket_type && serviceName[t.ticket_type] === undefined;
    const allTickets = data.tickets.filter(isTicket);
    const tickets = allTickets.filter(inFac);
    const nonTickets = data.tickets.filter(t => !isTicket(t)).filter(inFac);
    const expenses = data.expenses.filter(inFac);

    // Theo cơ sở
    const byFac = {};
    for (const code of facilities) byFac[code] = { tickets: 0, guests: 0, ticketRevenue: 0, revenue: 0, expense: 0, card: 0 };
    for (const d of data.daily) {
      const f = byFac[d.facility_code];
      f.revenue += d.ticket_revenue; f.expense += d.expense; f.card += d.card_amount;
    }
    for (const t of allTickets) {
      const f = byFac[t.facility_code];
      if (f) { f.tickets += t.ticket_count; f.guests += t.guest_count; f.ticketRevenue += t.revenue; }
    }

    // Vé theo loại
    const types = {};
    for (const t of tickets) {
      const k = t.ticket_type;
      const x = (types[k] = types[k] || { count: 0, revenue: 0, free: 0, byFac: {} });
      x.count += t.ticket_count; x.revenue += t.revenue; x.free += t.free_count;
      x.byFac[t.facility_code] = (x.byFac[t.facility_code] || 0) + t.ticket_count;
    }

    // Dịch vụ & tiền dư: tính vào doanh thu, không phải vé
    const extras = {};
    for (const t of nonTickets) {
      const k = t.ticket_type || '';
      const x = (extras[k] = extras[k] || {
        key: k, label: k ? `${k} — ${serviceName[k]}` : 'Tiền dư (không ghi loại vé)', revenue: 0, lines: 0, byFac: {},
      });
      x.revenue += t.revenue; x.lines += t.ticket_count;
      x.byFac[t.facility_code] = (x.byFac[t.facility_code] || 0) + t.revenue;
    }

    // Khuyến mãi: theo mã nếu có, không có mã thì theo kiểu KM. HH là kênh môi giới, không tính tiền giảm.
    const promos = {};
    for (const t of tickets) {
      if (!t.promo_code && !t.km_kind) continue;
      const key = t.promo_code || `kind:${t.km_kind}`;
      const x = (promos[key] = promos[key] || {
        key, code: t.promo_code, kind: t.km_kind, count: 0, revenue: 0, listValue: 0, unpriced: 0, free: 0, byFac: {},
      });
      x.count += t.ticket_count; x.revenue += t.revenue; x.free += t.free_count;
      x.byFac[t.facility_code] = (x.byFac[t.facility_code] || 0) + t.ticket_count;
      const price = priceMap[t.ticket_type];
      if (price === undefined) x.unpriced += t.ticket_count;
      else x.listValue += price * t.ticket_count;
    }
    const promoRows = Object.values(promos).map(p => ({
      ...p,
      name: p.code ? (codeName[p.code] || 'Chưa đặt tên') : KM_KIND_LABEL[p.kind] || p.kind,
      discount: p.kind === 'commission' && !p.code ? null : Math.max(0, p.listValue - p.revenue),
    })).sort((a, b) => b.count - a.count);

    // Chi theo loại
    const cats = {};
    for (const e of expenses) {
      const k = e.category || '(không ghi loại)';
      const x = (cats[k] = cats[k] || { total: 0, n: 0, byFac: {} });
      x.total += e.amount; x.n += 1;
      x.byFac[e.facility_code] = (x.byFac[e.facility_code] || 0) + e.amount;
    }

    // Theo ngày
    const days = {};
    const day = (date) => (days[date] = days[date] || { tickets: 0, revenue: 0, expense: 0 });
    for (const d of daily) {
      const x = day(d.date);
      x.revenue += d.ticket_revenue; x.expense += d.expense;
    }
    for (const t of tickets) day(t.date).tickets += t.ticket_count;

    // Hàng bán kèm (đối chiếu)
    const addons = {};
    for (const d of daily) {
      for (const [k, q] of Object.entries(d.addons || {})) {
        const x = (addons[k] = addons[k] || { total: 0, byFac: {} });
        x.total += q; x.byFac[d.facility_code] = (x.byFac[d.facility_code] || 0) + q;
      }
    }

    const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
    return {
      facilities,
      shownFacs: facility === 'ALL' ? facilities : [facility],
      byFac, types, extras: Object.values(extras).sort((a, b) => b.revenue - a.revenue), promoRows, cats, days, addons,
      totals: {
        revenue: sum(daily, 'ticket_revenue'),
        expense: sum(daily, 'expense'),
        tickets: sum(tickets, 'ticket_count'),
        guests: sum(tickets, 'guest_count'),
        promoTickets: promoRows.filter(p => p.kind !== 'commission' || p.code).reduce((a, p) => a + p.count, 0),
        discount: promoRows.reduce((a, p) => a + (p.discount || 0), 0),
      },
      expenseItems: expenses.filter(e => !expenseCategory || (e.category || '(không ghi loại)') === expenseCategory),
    };
  }, [data, facility, expenseCategory, priceMap, serviceName, codeName]);

  const lastImport = data?.imports?.[0];

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 overflow-y-auto custom-scrollbar h-[calc(100vh-120px)] animate-fade-in bg-gray-50 dark:bg-[#121212]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#1e1e1e] p-4 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-teal-600">fact_check</span> Đối chiếu tài chính
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {lastImport
              ? <>Từ file <b>{lastImport.file_name}</b> · {lastImport.imported_by} · {new Date(lastImport.imported_at).toLocaleString('vi-VN')}</>
              : 'Dữ liệu từ file tổng tháng do kế toán nhập ở mục Tổng quan doanh thu.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={facility} onChange={e => setFacility(e.target.value)} className="bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:text-white">
            <option value="ALL">Tất cả cơ sở</option>
            {(view?.facilities || []).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:text-white" />
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg p-3">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Đang tải…</div>}
      {!loading && view && view.facilities.length === 0 && (
        <div className="text-sm text-gray-500 bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          Chưa có dữ liệu file tổng cho tháng này{months.length ? ` (đã có: ${months.map(m => m.month).join(', ')})` : ''}.
        </div>
      )}

      {!loading && view && view.facilities.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              ['Doanh thu', view.totals.revenue, 'text-teal-600 dark:text-teal-400'],
              ['Chi phí', view.totals.expense, 'text-red-600 dark:text-red-400'],
              ['Lợi nhuận', view.totals.revenue - view.totals.expense, 'text-gray-900 dark:text-white'],
              [`Số vé (${fmt(view.totals.guests)} khách)`, view.totals.tickets, 'text-blue-600 dark:text-blue-400'],
              [`Giảm giá ước tính (${fmt(view.totals.promoTickets)} vé KM)`, view.totals.discount, 'text-amber-600 dark:text-amber-400'],
            ].map(([label, value, color]) => (
              <div key={label} className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
                <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">{label}</div>
                <div className={`text-xl font-black mt-1 ${color}`}>{fmt(value)}</div>
              </div>
            ))}
          </div>

          <Card title="Kết quả theo cơ sở">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                <Th left>Cơ sở</Th><Th>Số vé</Th><Th>Khách</Th><Th>Doanh thu</Th><Th>Chi</Th><Th>Lợi nhuận</Th><Th>Chi/DT</Th><Th>Giá TB/vé</Th><Th>Quẹt thẻ</Th>
              </tr></thead>
              <tbody className="text-gray-800 dark:text-gray-200">
                {view.facilities.map(code => {
                  const f = view.byFac[code];
                  return (
                    <tr key={code} className={`border-b border-gray-100 dark:border-gray-800 ${facility !== 'ALL' && facility !== code ? 'opacity-40' : ''}`}>
                      <Td left className="font-bold">{code}</Td><Td>{fmt(f.tickets)}</Td><Td>{fmt(f.guests)}</Td>
                      <Td className="font-semibold text-teal-700 dark:text-teal-400">{fmt(f.revenue)}</Td>
                      <Td className="text-red-600 dark:text-red-400">{fmt(f.expense)}</Td>
                      <Td className="font-semibold">{fmt(f.revenue - f.expense)}</Td>
                      <Td>{pct(f.expense, f.revenue)}</Td><Td>{fmt(f.tickets ? f.ticketRevenue / f.tickets : 0)}</Td><Td>{fmt(f.card)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="grid grid-cols-1 gap-6">
            <Card title="Vé theo loại">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <Th left>Loại</Th>{view.shownFacs.map(f => <Th key={f}>{f}</Th>)}<Th>Tổng vé</Th><Th>Doanh thu</Th><Th>TB/vé</Th><Th>Niêm yết</Th>
                </tr></thead>
                <tbody className="text-gray-800 dark:text-gray-200">
                  {Object.entries(view.types).sort((a, b) => b[1].count - a[1].count).map(([type, x]) => (
                    <tr key={type} className="border-b border-gray-100 dark:border-gray-800">
                      <Td left className="font-bold">{type}</Td>
                      {view.shownFacs.map(f => <Td key={f}>{x.byFac[f] ? fmt(x.byFac[f]) : ''}</Td>)}
                      <Td className="font-semibold">{fmt(x.count)}</Td><Td>{fmt(x.revenue)}</Td><Td>{fmt(x.revenue / x.count)}</Td>
                      <Td className="text-gray-500">{priceMap[type] !== undefined ? fmt(priceMap[type]) : '–'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {view.extras.length > 0 && (
              <Card title="Dịch vụ & tiền dư (tính vào doanh thu, không phải vé)">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                    <Th left>Khoản</Th>{view.shownFacs.map(f => <Th key={f}>{f}</Th>)}<Th>Tổng tiền</Th><Th>Số dòng ghi</Th>
                  </tr></thead>
                  <tbody className="text-gray-800 dark:text-gray-200">
                    {view.extras.map(x => (
                      <tr key={x.key} className="border-b border-gray-100 dark:border-gray-800">
                        <Td left className="font-medium">{x.label}</Td>
                        {view.shownFacs.map(f => <Td key={f}>{x.byFac[f] ? fmt(x.byFac[f]) : ''}</Td>)}
                        <Td className="font-semibold">{fmt(x.revenue)}</Td><Td>{x.lines}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            <Card title="Khuyến mãi & kênh bán">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <Th left>Mã / kiểu</Th><Th left>Chương trình</Th>{view.shownFacs.map(f => <Th key={f}>{f}</Th>)}
                  <Th>Tổng vé</Th><Th>Vé 0 đ</Th><Th>Thực thu</Th><Th>Giảm ước tính</Th>
                </tr></thead>
                <tbody className="text-gray-800 dark:text-gray-200">
                  {view.promoRows.map(p => (
                    <tr key={p.key} className="border-b border-gray-100 dark:border-gray-800">
                      <Td left className="font-bold">{p.code || (p.kind === 'combo' ? 'CB' : p.kind === 'commission' ? 'HH' : '–')}</Td>
                      <Td left className={p.code && !codeName[p.code] ? 'text-amber-600' : ''}>{p.name}</Td>
                      {view.shownFacs.map(f => <Td key={f}>{p.byFac[f] ? fmt(p.byFac[f]) : ''}</Td>)}
                      <Td className="font-semibold">{fmt(p.count)}</Td><Td>{p.free ? fmt(p.free) : ''}</Td><Td>{fmt(p.revenue)}</Td>
                      <Td className="text-amber-700 dark:text-amber-400">
                        {p.discount === null ? 'không áp dụng' : `${fmt(p.discount)}${p.unpriced ? ` (${p.unpriced} vé chưa có giá)` : ''}`}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Giảm ước tính = giá niêm yết × số vé − thực thu. HH là vé bán qua môi giới: tiền hoa hồng nằm ở chi "HH dẫn khách", không tính là giảm giá.
              </p>
            </Card>
          </div>

          <Card title="Chi phí theo loại" right={expenseCategory && (
            <button onClick={() => setExpenseCategory('')} className="text-xs text-teal-700 dark:text-teal-400 font-bold">Bỏ lọc "{expenseCategory}"</button>
          )}>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                <Th left>Loại chi phí</Th>{view.shownFacs.map(f => <Th key={f}>{f}</Th>)}<Th>Tổng</Th><Th>Số khoản</Th><Th>% chi</Th>
              </tr></thead>
              <tbody className="text-gray-800 dark:text-gray-200">
                {Object.entries(view.cats).sort((a, b) => b[1].total - a[1].total).map(([cat, x]) => (
                  <tr key={cat} onClick={() => setExpenseCategory(cat)} className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 ${expenseCategory === cat ? 'bg-teal-50 dark:bg-teal-900/20' : ''}`}>
                    <Td left className="font-medium">{cat}</Td>
                    {view.shownFacs.map(f => <Td key={f}>{x.byFac[f] ? fmt(x.byFac[f]) : ''}</Td>)}
                    <Td className="font-semibold">{fmt(x.total)}</Td><Td>{x.n}</Td><Td>{pct(x.total, view.totals.expense)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={`Khoản chi${expenseCategory ? ` — ${expenseCategory}` : ''} (${view.expenseItems.length})`}>
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-[#1e1e1e]"><tr className="border-b border-gray-200 dark:border-gray-700">
                  <Th left>Ngày</Th><Th left>Cơ sở</Th><Th left>Nội dung</Th><Th left>Loại</Th><Th>Số tiền</Th>
                </tr></thead>
                <tbody className="text-gray-800 dark:text-gray-200">
                  {view.expenseItems.map(e => (
                    <tr key={e.id} className="border-b border-gray-100 dark:border-gray-800">
                      <Td left>{e.date.split('-').reverse().slice(0, 2).join('/')}</Td><Td left>{e.facility_code}</Td>
                      <Td left className="max-w-[320px] truncate">{e.description}</Td><Td left className="text-gray-500">{e.category}</Td>
                      <Td className="font-semibold">{fmt(e.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card title="Theo ngày">
              <div className="max-h-96 overflow-y-auto custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-[#1e1e1e]"><tr className="border-b border-gray-200 dark:border-gray-700">
                    <Th left>Ngày</Th><Th>Số vé</Th><Th>Doanh thu</Th><Th>Chi</Th><Th>Lợi nhuận</Th>
                  </tr></thead>
                  <tbody className="text-gray-800 dark:text-gray-200">
                    {Object.entries(view.days).sort().map(([date, x]) => (
                      <tr key={date} className="border-b border-gray-100 dark:border-gray-800">
                        <Td left>{date.split('-').reverse().slice(0, 2).join('/')}</Td><Td>{fmt(x.tickets)}</Td>
                        <Td className="text-teal-700 dark:text-teal-400">{fmt(x.revenue)}</Td><Td className="text-red-600 dark:text-red-400">{fmt(x.expense)}</Td>
                        <Td className="font-semibold">{fmt(x.revenue - x.expense)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Hàng bán kèm (đối chiếu, không tính doanh thu)">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <Th left>Mặt hàng</Th>{view.shownFacs.map(f => <Th key={f}>{f}</Th>)}<Th>Tổng</Th>
                </tr></thead>
                <tbody className="text-gray-800 dark:text-gray-200">
                  {Object.entries(view.addons).sort((a, b) => b[1].total - a[1].total).map(([name, x]) => (
                    <tr key={name} className="border-b border-gray-100 dark:border-gray-800">
                      <Td left className="font-medium">{name}</Td>
                      {view.shownFacs.map(f => <Td key={f}>{x.byFac[f] ? fmt(x.byFac[f]) : ''}</Td>)}
                      <Td className="font-semibold">{fmt(x.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          {data.imports?.length > 0 && (
            <Card title="Lịch sử nhập tháng này">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <Th left>Thời điểm</Th><Th left>Người nhập</Th><Th left>File</Th><Th>Doanh thu</Th><Th>Chi</Th><Th>Cảnh báo</Th>
                </tr></thead>
                <tbody className="text-gray-800 dark:text-gray-200">
                  {data.imports.map(imp => {
                    const s = Object.values(imp.summary || {});
                    return (
                      <tr key={imp.id} className="border-b border-gray-100 dark:border-gray-800" title={(imp.warnings || []).map(w => `${w.facility ? w.facility + ': ' : ''}${w.message}`).join('\n')}>
                        <Td left>{new Date(imp.imported_at).toLocaleString('vi-VN')}</Td><Td left>{imp.imported_by}</Td><Td left>{imp.file_name}</Td>
                        <Td>{fmt(s.reduce((a, x) => a + (x.revenue || 0), 0))}</Td><Td>{fmt(s.reduce((a, x) => a + (x.expense || 0), 0))}</Td>
                        <Td>{(imp.warnings || []).length}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {canEdit && <FinanceSettings config={config} onSaved={setConfig} />}
    </div>
  );
}

// Bảng giá niêm yết + tên mã khuyến mãi (kế toán sửa)
function FinanceSettings({ config, onSaved }) {
  const [prices, setPrices] = React.useState([]);
  const [codes, setCodes] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => {
    setPrices(config.prices.map(p => ({ ...p, kind: p.kind || 'ticket', list_price: p.list_price ?? '', name: p.name || '' })));
    setCodes(config.promoCodes.map(c => ({ ...c })));
  }, [config]);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      // Vé cần giá niêm yết; dịch vụ thì không
      const cleanPrices = prices
        .filter(p => p.ticket_type && (p.kind === 'service' || p.list_price !== ''))
        .map(p => ({
          ticket_type: p.ticket_type.trim().toUpperCase(),
          kind: p.kind,
          name: p.name?.trim() || null,
          list_price: p.list_price === '' ? null : Number(p.list_price),
        }));
      const cleanCodes = codes.filter(c => c.code && c.name).map(c => ({ code: c.code.trim().toUpperCase(), name: c.name.trim() }));
      await saveFinanceConfig({ prices: cleanPrices, promoCodes: cleanCodes });
      onSaved(await fetchFinanceConfig());
      setMsg('Đã lưu.');
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const input = 'bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-sm dark:text-white';
  return (
    <Card title="Cài đặt đối chiếu (kế toán)" right={
      <div className="flex items-center gap-3">
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
        <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50">Lưu cài đặt</button>
      </div>
    }>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="font-bold text-sm text-gray-700 dark:text-gray-300 mb-1">Loại vé & dịch vụ (cột Loại vé, chung mọi cơ sở)</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Vé: cần giá niêm yết để ước tính tiền giảm. Dịch vụ: tính vào doanh thu nhưng không đếm là vé.</p>
          <div className="space-y-1.5">
            {prices.map((p, i) => {
              const set = (patch) => setPrices(ps => ps.map((x, j) => j === i ? { ...x, ...patch } : x));
              return (
                <div key={i} className="flex gap-2">
                  <input className={`${input} w-20`} value={p.ticket_type} placeholder="Mã" onChange={e => set({ ticket_type: e.target.value })} />
                  <select className={`${input} w-24`} value={p.kind} onChange={e => set({ kind: e.target.value })}>
                    <option value="ticket">Vé</option>
                    <option value="service">Dịch vụ</option>
                  </select>
                  {p.kind === 'service'
                    ? <input className={`${input} flex-1`} value={p.name} placeholder="Tên dịch vụ" onChange={e => set({ name: e.target.value })} />
                    : <input className={`${input} w-32 text-right`} type="number" value={p.list_price} placeholder="Giá niêm yết" onChange={e => set({ list_price: e.target.value })} />}
                </div>
              );
            })}
            <button onClick={() => setPrices(ps => [...ps, { ticket_type: '', kind: 'ticket', list_price: '', name: '' }])} className="text-xs font-bold text-teal-700 dark:text-teal-400">+ Thêm loại vé / dịch vụ</button>
          </div>
        </div>
        <div>
          <h4 className="font-bold text-sm text-gray-700 dark:text-gray-300 mb-2">Mã khuyến mãi (cột Code)</h4>
          <div className="space-y-1.5">
            {codes.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input className={`${input} w-24`} value={c.code} onChange={e => setCodes(cs => cs.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} />
                <input className={`${input} flex-1`} value={c.name} onChange={e => setCodes(cs => cs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              </div>
            ))}
            <button onClick={() => setCodes(cs => [...cs, { code: '', name: '' }])} className="text-xs font-bold text-teal-700 dark:text-teal-400">+ Thêm mã</button>
          </div>
        </div>
      </div>
    </Card>
  );
}
