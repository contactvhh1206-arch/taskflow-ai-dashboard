import React from 'react';
import { fetchRevenueForecast, saveForecastSettings } from '../services/dataService.js';

// Dự đoán doanh thu: mọi số do backend tính (backend/src/services/revenueForecast.js), màn hình chỉ hiển thị.
const SETTINGS_ROLES = ['FINANCE_DEPT', 'SUPER_ADMIN'];

const TREND = {
  up: { label: 'Tăng', icon: 'trending_up', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  flat: { label: 'Bằng', icon: 'trending_flat', cls: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200' },
  down: { label: 'Giảm', icon: 'trending_down', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
};

const fmt = (v) => (v === null || v === undefined ? '—' : new Intl.NumberFormat('vi-VN').format(Math.round(v)));
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}%`);
const monthLabel = (m) => `T${m.slice(5, 7)}/${m.slice(0, 4)}`;
const dayLabel = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const shortDay = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const TrendBadge = ({ trend }) => {
  if (!trend) return <span className="text-xs text-gray-500 dark:text-gray-400">Chưa đủ 1 năm</span>;
  const t = TREND[trend];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${t.cls}`}>
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{t.icon}</span>
      {t.label}
    </span>
  );
};

const methodNote = (m) => (m.chain.method === 'actual_run_rate'
  ? `Tính từ số đã có của ${monthLabel(m.month)}, trung bình/ngày × ${m.daysInMonth} ngày.`
  : `Tính từ trung bình/ngày ${m.baseMonths.map(monthLabel).join(', ')}${m.seasonalFactor === null ? ', chưa có hệ số mùa vì thiếu số năm trước' : ' và hệ số mùa năm trước'}.`);

export default function RevenueForecastPanel({ user, refreshToggle }) {
  const [state, setState] = React.useState({ loading: true, error: '', data: null });
  const [tab, setTab] = React.useState('current');
  const [bandInput, setBandInput] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [settingError, setSettingError] = React.useState('');
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: '' }));
    fetchRevenueForecast()
      .then(data => {
        if (!alive) return;
        setState({ loading: false, error: '', data });
        setBandInput(String(data.flatBandPct));
      })
      .catch(e => { if (alive) setState({ loading: false, error: e.message || 'Không tải được dự đoán.', data: null }); });
    return () => { alive = false; };
  }, [refreshToggle, reloadKey]);

  const saveBand = async () => {
    setSaving(true);
    setSettingError('');
    try {
      await saveForecastSettings(Number(String(bandInput).replace(',', '.')));
      setReloadKey(k => k + 1);
    } catch (e) {
      setSettingError(e.message || 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  const { loading, error, data } = state;
  const shell = 'bg-white dark:bg-[#1e1e1e] p-4 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm shrink-0';

  if (error) {
    return (
      <section className={shell} aria-label="Dự đoán doanh thu">
        <p className="text-sm text-red-600 dark:text-red-400">Không tải được dự đoán: {error}</p>
        <button onClick={() => setReloadKey(k => k + 1)} className="mt-2 text-sm font-bold text-teal-700 dark:text-teal-400 hover:underline">Thử lại</button>
      </section>
    );
  }
  if (!data) {
    return <section className={shell} aria-label="Dự đoán doanh thu"><p className="text-sm text-gray-500 dark:text-gray-400">Đang tính dự đoán...</p></section>;
  }

  const m = tab === 'current' ? data.current : data.next;
  const c = m.chain;
  const missing = m.facilities.filter(r => r.missingDates.length > 0);
  const chainScores = data.accuracy.filter(a => a.facility === 'ALL').slice(0, 6);

  return (
    <section className={`${shell} flex flex-col gap-4 ${loading ? 'opacity-70' : ''}`} aria-label="Dự đoán doanh thu">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-teal-600" aria-hidden="true">query_stats</span>
            Dự đoán doanh thu
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Số liệu có tới {dayLabel(data.lastDataDate)}. Đây là ước tính, không phải số chốt.</p>
        </div>
        <div className="inline-flex self-start rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden" role="group" aria-label="Chọn tháng dự đoán">
          {[['current', data.current.month], ['next', data.next.month]].map(([key, month]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`px-4 py-2 text-sm font-bold ${tab === key ? 'bg-teal-600 text-white' : 'bg-white dark:bg-[#252525] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2c2c2c]'}`}
            >
              {monthLabel(month)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg bg-gray-50 dark:bg-[#252525] p-4">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400">Toàn chuỗi dự đoán {monthLabel(m.month)}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{fmt(c.forecast)}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 tabular-nums">Khoảng {fmt(c.low)} – {fmt(c.high)} (±{c.bandPct}%)</p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-[#252525] p-4">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400">So với cùng tháng năm trước</p>
          <div className="flex items-center gap-2 mt-1">
            <TrendBadge trend={c.trend} />
            <span className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{fmtPct(c.yoyPct)}</span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 tabular-nums">Năm trước: {fmt(c.lastYear)}</p>
          {c.excludedFromComparison.length > 0 && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Không so sánh: {c.excludedFromComparison.join(', ')} (chưa đủ 1 năm)</p>
          )}
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-[#252525] p-4">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400">Để bằng năm trước</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{c.needPerDay === null ? '—' : `${fmt(c.needPerDay)}/ngày`}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 tabular-nums">
            {c.shortTicketsPerDay === null
              ? (c.lastYear === null ? 'Chưa đủ số năm trước' : 'Tháng sắp hết, không tính số vé thiếu mỗi ngày')
              : c.shortTicketsPerDay > 0 ? `Thiếu khoảng ${Math.ceil(c.shortTicketsPerDay)} vé/ngày so với dự đoán` : 'Dự đoán đang đạt mức này'}
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-600 dark:text-gray-400">{methodNote(m)}{m.hasTet ? ' Tháng có Tết nên khoảng dao động rộng hơn, mức giảm Tết chưa được kiểm chứng nhiều.' : ''}</p>

      {data.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3" role="status">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">warning</span> Cảnh báo sớm
          </p>
          <ul className="mt-1 text-sm text-amber-900 dark:text-amber-200 list-disc pl-5">
            {data.warnings.map(w => (
              <li key={w.facility}>{w.facility}: 7 ngày tới {shortDay(w.lastDate)} đạt {fmt(w.recentWeek)}, {fmtPct(w.changePct)} so với trung bình 4 tuần trước ({fmt(w.previousWeekAvg)}/tuần).</li>
            ))}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <p className="text-sm text-amber-800 dark:text-amber-300" role="status">
          Có ngày chưa nhập số, không tính vào trung bình: {missing.map(r => `${r.facility} (${r.missingDates.slice(0, 5).map(shortDay).join(', ')}${r.missingDates.length > 5 ? ` +${r.missingDates.length - 5}` : ''})`).join('; ')}.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <caption className="sr-only">Dự đoán doanh thu từng cơ sở {monthLabel(m.month)}</caption>
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th scope="col" className="py-2 pr-3 font-bold">Cơ sở</th>
              <th scope="col" className="py-2 pr-3 font-bold text-right">Đã có</th>
              <th scope="col" className="py-2 pr-3 font-bold text-right">Dự đoán</th>
              <th scope="col" className="py-2 pr-3 font-bold text-right">Năm trước</th>
              <th scope="col" className="py-2 pr-3 font-bold">So năm trước</th>
              <th scope="col" className="py-2 pr-3 font-bold text-right">Cần mỗi ngày</th>
              <th scope="col" className="py-2 font-bold text-right">Thiếu vé/ngày</th>
            </tr>
          </thead>
          <tbody>
            {m.facilities.map(r => (
              <tr key={r.facility} className="border-b border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200 tabular-nums">
                <th scope="row" className="py-2 pr-3 font-bold text-left">{r.facility}</th>
                <td className="py-2 pr-3 text-right">{r.daysWithData ? `${fmt(r.done)} (${r.daysWithData} ngày)` : '—'}</td>
                <td className="py-2 pr-3 text-right font-bold">{fmt(r.forecast)}</td>
                <td className="py-2 pr-3 text-right">{fmt(r.lastYear)}</td>
                <td className="py-2 pr-3"><span className="inline-flex items-center gap-2"><TrendBadge trend={r.trend} />{r.trend && fmtPct(r.yoyPct)}</span></td>
                <td className="py-2 pr-3 text-right">{fmt(r.needPerDay)}</td>
                <td className="py-2 text-right">{r.shortTicketsPerDay === null ? '—' : r.shortTicketsPerDay > 0 ? Math.ceil(r.shortTicketsPerDay) : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">Từng cơ sở dao động nhiều hơn toàn chuỗi (khoảng ±{m.facilities[0]?.bandPct ?? '—'}%), chỉ nên đọc như hướng tham khảo.</p>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-t border-gray-200 dark:border-gray-700 pt-3">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          <p className="font-bold">Chấm điểm dự đoán tháng sau</p>
          {!data.snapshotsReady && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Chưa lưu được dự đoán, cần chạy migration 011.</p>}
          {data.snapshotsReady && chainScores.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Chưa có tháng nào để chấm. Dự đoán đang được lưu từ {dayLabel(data.asOf)}, có kết quả sau khi tháng được dự đoán kết thúc.</p>
          )}
          {chainScores.length > 0 && (
            <ul className="mt-1 text-xs tabular-nums">
              {chainScores.map(a => (
                <li key={a.month}>{monthLabel(a.month)}: dự đoán {fmt(a.forecast)}, thực tế {fmt(a.actual)}, sai {fmtPct(a.errorPct)}{a.withinBand ? '' : ' (ngoài khoảng)'}</li>
              ))}
            </ul>
          )}
        </div>
        {SETTINGS_ROLES.includes(user?.role) ? (
          <div className="shrink-0">
            <label htmlFor="forecast-flat-band" className="text-xs font-bold text-gray-700 dark:text-gray-300 block">Coi là "bằng" khi lệch trong (±%)</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                id="forecast-flat-band"
                type="number" min="0.5" max="20" step="0.5"
                value={bandInput}
                onChange={e => setBandInput(e.target.value)}
                className="w-20 bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm dark:text-white outline-none focus:border-teal-500"
              />
              <button onClick={saveBand} disabled={saving || Number(bandInput) === data.flatBandPct} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
            {settingError && <p className="text-xs text-red-600 dark:text-red-400 mt-1" role="alert">{settingError}</p>}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 shrink-0">"Bằng" là lệch trong ±{data.flatBandPct}%.</p>
        )}
      </div>
    </section>
  );
}
