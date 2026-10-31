import React from 'react';
import { fetchRevenueSources } from '../services/dataService.js';

// Doanh thu theo nguồn khách của tháng đang tra cứu; số do backend tính (backend/src/services/revenueSources.js).
const fmt = (v) => (v === null || v === undefined ? '—' : new Intl.NumberFormat('vi-VN').format(Math.round(v)));
const fmtPct = (v, signed = false) => (v === null || v === undefined ? '—' : `${signed && v > 0 ? '+' : ''}${String(v).replace('.', ',')}%`);
const monthLabel = (m) => `T${m.slice(5, 7)}/${m.slice(0, 4)}`;

export default function RevenueSourcesPanel({ selectedMonth, refreshToggle }) {
  const [state, setState] = React.useState({ loading: true, error: '', data: null });
  const [facility, setFacility] = React.useState('ALL');
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: '' }));
    fetchRevenueSources(selectedMonth)
      .then(data => { if (alive) setState({ loading: false, error: '', data }); })
      .catch(e => { if (alive) setState({ loading: false, error: e.message || 'Không tải được.', data: null }); });
    return () => { alive = false; };
  }, [selectedMonth, refreshToggle, reloadKey]);

  const { loading, error, data } = state;
  const shell = 'bg-white dark:bg-[#1e1e1e] p-4 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm shrink-0';
  const heading = (
    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
      <span className="material-symbols-outlined text-teal-600" aria-hidden="true">groups</span>
      Doanh thu theo nguồn khách {data ? monthLabel(selectedMonth) : ''}
    </h3>
  );

  if (error) {
    return (
      <section className={shell} aria-label="Doanh thu theo nguồn khách">
        {heading}
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">Không tải được: {error}</p>
        <button onClick={() => setReloadKey(k => k + 1)} className="mt-2 text-sm font-bold text-teal-700 dark:text-teal-400 hover:underline">Thử lại</button>
      </section>
    );
  }
  if (!data) {
    return <section className={shell} aria-label="Doanh thu theo nguồn khách"><p className="text-sm text-gray-500 dark:text-gray-400">Đang tải nguồn khách...</p></section>;
  }
  if (!data.facilities.length) {
    return (
      <section className={shell} aria-label="Doanh thu theo nguồn khách">
        {heading}
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Tháng này chưa có file tổng nên chưa tách được nguồn khách.</p>
      </section>
    );
  }

  const scope = facility !== 'ALL' && data.byFacility[facility] ? data.byFacility[facility] : data.chain;
  const maxShare = Math.max(1, ...scope.groups.map(g => g.sharePct));

  return (
    <section className={`${shell} flex flex-col gap-3 ${loading ? 'opacity-70' : ''}`} aria-label="Doanh thu theo nguồn khách">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          {heading}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Tách từ cột Code và KM của file tổng. Tổng: {fmt(scope.totalRevenue)}.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="source-facility" className="text-sm font-bold text-gray-700 dark:text-gray-300">Cơ sở</label>
          <select
            id="source-facility"
            value={facility}
            onChange={e => setFacility(e.target.value)}
            className="bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm dark:text-white outline-none focus:border-teal-500"
          >
            <option value="ALL">Toàn chuỗi</option>
            {data.facilities.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <caption className="sr-only">Doanh thu theo nguồn khách {monthLabel(data.month)}</caption>
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th scope="col" className="py-2 pr-3 font-bold">Nguồn</th>
              <th scope="col" className="py-2 pr-3 font-bold text-right">Doanh thu</th>
              <th scope="col" className="py-2 pr-3 font-bold w-1/4">Tỷ trọng</th>
              <th scope="col" className="py-2 pr-3 font-bold text-right">Số vé</th>
              <th scope="col" className="py-2 pr-3 font-bold text-right">Thu TB/vé</th>
              <th scope="col" className="py-2 font-bold text-right">TB/ngày so năm trước</th>
            </tr>
          </thead>
          <tbody>
            {scope.groups.map(g => (
              <tr key={g.key} className="border-b border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200 tabular-nums">
                <th scope="row" className="py-2 pr-3 text-left font-bold">
                  {g.label}
                  <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">{g.note}</span>
                </th>
                <td className="py-2 pr-3 text-right font-bold">{fmt(g.revenue)}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden" aria-hidden="true">
                      <div className="h-full bg-teal-600" style={{ width: `${(g.sharePct / maxShare) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right text-xs">{fmtPct(g.sharePct)}</span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right">{fmt(g.tickets)}</td>
                <td className="py-2 pr-3 text-right">{fmt(g.avgTicket)}</td>
                <td className="py-2 text-right">{fmtPct(g.yoyPct, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.commissionNotMarked && (
        <p className="text-sm text-amber-800 dark:text-amber-300" role="status">
          File tháng này chưa ghi đủ vé môi giới (đủ từ T04/2026), nên vé môi giới đang nằm trong "Không mã, không giảm".
        </p>
      )}
      {!data.commissionNotMarked && data.commissionNotComparable && (
        <p className="text-sm text-amber-800 dark:text-amber-300" role="status">
          Không so năm trước nhóm "Không mã, không giảm" và "Môi giới hoa hồng", vì tháng này năm trước chưa ghi vé môi giới.
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {scope.comparedFacilities.length
          ? `So năm trước theo trung bình/ngày, chỉ trên ${scope.comparedFacilities.join(', ')}. Dấu — là chưa so được.`
          : 'Chưa so được với năm trước vì cơ sở chưa đủ số cùng tháng năm trước.'}
        {' '}"Không mã, không giảm" được coi như khách tự đến, vì file không ghi rõ nguồn.
      </p>
    </section>
  );
}
