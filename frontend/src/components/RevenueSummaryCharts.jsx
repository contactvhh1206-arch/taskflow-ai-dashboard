import React from 'react';
import { fetchFinanceConfig, fetchFinanceMonth, fetchReports } from '../services/dataService.js';
import { buildRevenueSummary, previousMonth, readFacilityKpis } from '../utils/financeSummary.js';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const shortMonth = (m) => `T${Number(m.split('-')[1])}`;

// Màu theo vai trò: doanh thu = xanh, lợi nhuận/chi = cam, ngày cuối tuần = xanh đậm
const COLOR_MAIN = 'bg-[#2a78d6] dark:bg-[#3987e5]';
const COLOR_WEEKEND = 'bg-[#1c5cab] dark:bg-[#7fb0ee]';
const COLOR_SECOND = 'bg-[#eb6834] dark:bg-[#d95926]';

const Panel = ({ title, hint, legend, children }) => (
  <section className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-4 md:p-5 min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 mb-4">
      <div className="min-w-0">
        <h3 className="font-bold text-gray-900 dark:text-white">{title}</h3>
        {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {legend}
    </div>
    {children}
  </section>
);

const LegendItem = ({ swatch, label }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
    <span className={`inline-block ${swatch}`}></span>{label}
  </span>
);

function StatTile({ label, value, prev, prevLabel, emptyText }) {
  let delta = null;
  if (value !== null && prev) {
    const change = (value - prev) / Math.abs(prev);
    delta = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change * 100).toFixed(1).replace('.', ',')}% so với ${prevLabel}`;
  }
  return (
    <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-4 min-w-0">
      <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-xl md:text-2xl font-black text-gray-900 dark:text-white mt-1 truncate">
        {value === null ? '–' : fmt(value)}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[16px]">
        {value === null ? emptyText : (delta || 'Chưa có số tháng trước để so')}
      </div>
    </div>
  );
}

// Biểu đồ cột theo ngày: một trục, cột mảnh, vạch KPI trên từng cột, tooltip khi rê chuột
function DailyChart({ days, lastDay }) {
  const [hover, setHover] = React.useState(null);
  const max = Math.max(1, ...days.map(d => Math.max(d.revenue, d.target)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step * 2) / 2 * step; // làm tròn lên mốc đẹp
  const ticks = [top, top / 2, 0];
  const hovered = hover === null ? null : days[hover];
  const hasTarget = days.some(d => d.target > 0);

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative w-14 shrink-0 h-48 text-[10px] text-gray-500 dark:text-gray-400 text-right">
          {ticks.map((t, i) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>{fmt(t)}</span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0 h-48" onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <div key={t} className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-800" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}></div>
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {days.map((d, i) => (
              <div
                key={d.day}
                role="img"
                aria-label={`Ngày ${d.date}: doanh thu ${fmt(d.revenue)}${d.target ? `, KPI ${fmt(d.target)}` : ''}`}
                className={`relative flex-1 min-w-0 h-full flex items-end ${hover === i ? 'bg-gray-100 dark:bg-gray-800/60' : ''}`}
                onMouseEnter={() => setHover(i)}
              >
                {d.revenue > 0 && (
                  <div className={`w-full rounded-t ${d.isWeekend ? COLOR_WEEKEND : COLOR_MAIN}`} style={{ height: `${(d.revenue / top) * 100}%` }}></div>
                )}
                {d.target > 0 && (
                  <div className="absolute inset-x-0 h-0.5 bg-gray-900 dark:bg-gray-100" style={{ bottom: `${(d.target / top) * 100}%` }}></div>
                )}
              </div>
            ))}
          </div>
          {hovered && (
            <div
              className="absolute z-10 top-0 pointer-events-none bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 rounded-lg px-3 py-2 text-xs shadow-lg whitespace-nowrap"
              style={hover > days.length / 2 ? { right: `${100 - ((hover + 0.5) / days.length) * 100}%` } : { left: `${((hover + 0.5) / days.length) * 100}%` }}
            >
              <div className="font-bold">{hovered.date}{hovered.isWeekend ? ' (cuối tuần)' : ''}</div>
              <div>Doanh thu: {hovered.revenue ? fmt(hovered.revenue) : 'chưa có số'}</div>
              {hovered.target > 0 && <div>KPI: {fmt(hovered.target)}</div>}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-1">
        <div className="w-14 shrink-0"></div>
        <div className="flex-1 min-w-0 flex gap-[2px] text-[10px] text-gray-500 dark:text-gray-400">
          {days.map(d => (
            <div key={d.day} className="flex-1 min-w-0 text-center">{d.day === 1 || d.day % 5 === 0 ? d.day : ''}</div>
          ))}
        </div>
      </div>
      {lastDay === 0 && <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Tháng này chưa có doanh thu.</p>}
      {!hasTarget && lastDay > 0 && <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Chưa có KPI ngày để so.</p>}
    </div>
  );
}

// Một dòng thanh ngang: nhãn, thanh (bo đầu), giá trị
const HBar = ({ ratio, color, value }) => (
  <div className="flex items-center gap-2 min-w-0">
    <div className="flex-1 min-w-0 h-3">
      <div className={`h-full rounded-r ${color}`} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 1 : 0)}%` }}></div>
    </div>
    <span className="w-24 shrink-0 text-right text-xs font-semibold text-gray-800 dark:text-gray-200 tabular-nums">{value}</span>
  </div>
);

const EmptyFinance = () => (
  <p className="text-sm text-gray-500 dark:text-gray-400">Tháng này chưa nhập file tổng nên chưa có số này.</p>
);

// Tóm tắt bằng biểu đồ ở đầu Tổng quan doanh thu
export default function RevenueSummaryCharts({ selectedMonth, facilityList, refreshToggle }) {
  const [raw, setRaw] = React.useState(null);
  const [error, setError] = React.useState('');
  const [selectedFacility, setSelectedFacility] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    const prevMonth = previousMonth(selectedMonth);
    (async () => {
      try {
        // Mỗi tháng dùng đúng cài đặt của tháng đó (dịch vụ vs vé)
        const [reports, finance, prevFinance, config, prevConfig] = await Promise.all([
          fetchReports(),
          fetchFinanceMonth(selectedMonth),
          fetchFinanceMonth(prevMonth),
          fetchFinanceConfig(selectedMonth),
          fetchFinanceConfig(prevMonth),
        ]);
        if (!cancelled) { setRaw({ month: selectedMonth, reports, finance, prevFinance, config, prevConfig }); setError(''); }
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedMonth, refreshToggle]);

  const summary = React.useMemo(() => {
    if (!raw || raw.month !== selectedMonth || !facilityList?.length) return null;
    return buildRevenueSummary({ ...raw, facilityList, kpis: readFacilityKpis(), selectedFacility });
  }, [raw, selectedMonth, facilityList, selectedFacility]);

  if (error) {
    return <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg p-3">Không tải được tóm tắt: {error}</div>;
  }
  if (!summary) {
    return <div className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-gray-800 h-64 animate-pulse shrink-0"></div>;
  }

  const { totals, facilities, days, lastDay, daysInMonth, expenseGroups, promo, hasFinance } = summary;
  const isPartial = lastDay > 0 && lastDay < daysInMonth;
  const prevLabel = isPartial ? `cùng kỳ ${shortMonth(previousMonth(selectedMonth))}` : shortMonth(previousMonth(selectedMonth));
  const noFile = 'Chưa nhập file tổng tháng này';
  const maxFac = Math.max(1, ...facilities.map(f => f.revenue));
  const maxExpense = Math.max(1, ...expenseGroups.map(e => e.total));
  const maxRate = Math.max(0.01, ...promo.map(p => p.rate));
  const scope = selectedFacility ? ` — ${selectedFacility}` : '';

  return (
    <div className="flex flex-col gap-4 shrink-0">
      {selectedFacility && (
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          Đang xem cơ sở <b>{selectedFacility}</b>
          <button onClick={() => setSelectedFacility(null)} className="text-xs font-bold text-teal-700 dark:text-teal-400 underline">Xem cả chuỗi</button>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Doanh thu" value={totals.revenue} prev={totals.prevRevenue} prevLabel={prevLabel} />
        <StatTile label="Chi phí" value={totals.expense} prev={totals.prevExpense} prevLabel={prevLabel} emptyText={noFile} />
        <StatTile label="Lợi nhuận" value={totals.profit} prev={totals.prevProfit} prevLabel={prevLabel} emptyText={noFile} />
        <StatTile label="Số vé" value={totals.tickets} prev={totals.prevTickets} prevLabel={prevLabel} emptyText={noFile} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel
          title={`Doanh thu theo ngày${scope}`}
          hint={lastDay > 0 ? `Có số đến ngày ${lastDay}/${Number(selectedMonth.split('-')[1])}` : undefined}
          legend={
            <div className="flex flex-wrap gap-3">
              <LegendItem swatch={`w-3 h-3 rounded-sm ${COLOR_MAIN}`} label="Ngày thường" />
              <LegendItem swatch={`w-3 h-3 rounded-sm ${COLOR_WEEKEND}`} label="T6, T7" />
              {days.some(d => d.target > 0) && <LegendItem swatch="w-3 h-0.5 bg-gray-900 dark:bg-gray-100" label="KPI" />}
            </div>
          }
        >
          <DailyChart days={days} lastDay={lastDay} />
        </Panel>

        <Panel
          title="Doanh thu và lợi nhuận theo cơ sở"
          hint="Bấm vào một cơ sở để xem riêng cơ sở đó"
          legend={
            <div className="flex flex-wrap gap-3">
              <LegendItem swatch={`w-3 h-3 rounded-sm ${COLOR_MAIN}`} label="Doanh thu" />
              {hasFinance && <LegendItem swatch={`w-3 h-3 rounded-sm ${COLOR_SECOND}`} label="Lợi nhuận" />}
            </div>
          }
        >
          <div className="flex flex-col gap-1">
            {facilities.map(f => (
              <button
                key={f.code}
                onClick={() => setSelectedFacility(prev => (prev === f.code ? null : f.code))}
                aria-pressed={selectedFacility === f.code}
                className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/60 ${selectedFacility === f.code ? 'bg-gray-100 dark:bg-gray-800' : ''} ${selectedFacility && selectedFacility !== f.code ? 'opacity-50' : ''}`}
              >
                <span className="w-10 shrink-0 text-sm font-bold text-gray-800 dark:text-gray-200">{f.code}</span>
                <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                  <HBar ratio={f.revenue / maxFac} color={COLOR_MAIN} value={fmt(f.revenue)} />
                  {f.profit !== null && <HBar ratio={Math.max(f.profit, 0) / maxFac} color={COLOR_SECOND} value={fmt(f.profit)} />}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={`Chi phí theo nhóm${scope}`} hint={hasFinance && totals.expense ? `Tổng ${fmt(totals.expense)}` : undefined}>
          {!hasFinance ? <EmptyFinance /> : (
            <div className="flex flex-col gap-2">
              {expenseGroups.map(e => (
                <div key={e.name} className="min-w-0">
                  <div className="flex justify-between gap-2 text-xs text-gray-600 dark:text-gray-300 mb-0.5">
                    <span className="truncate">{e.name}</span>
                    <span className="shrink-0 tabular-nums">{totals.expense ? `${((e.total / totals.expense) * 100).toFixed(1).replace('.', ',')}%` : ''}</span>
                  </div>
                  <HBar ratio={e.total / maxExpense} color={e.isRest ? 'bg-gray-400 dark:bg-gray-500' : COLOR_MAIN} value={fmt(e.total)} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Tỷ lệ vé khuyến mãi theo cơ sở" hint="Không tính vé môi giới HH">
          {!hasFinance ? <EmptyFinance /> : (
            <div className="flex flex-col gap-2.5">
              {promo.map(p => (
                <div key={p.code} className="flex items-center gap-3 min-w-0" title={`${p.promoTickets} / ${p.tickets} vé`}>
                  <span className="w-10 shrink-0 text-sm font-bold text-gray-800 dark:text-gray-200">{p.code}</span>
                  <div className="flex-1 min-w-0">
                    <HBar ratio={p.rate / maxRate} color={COLOR_MAIN} value={`${(p.rate * 100).toFixed(1).replace('.', ',')}% · ${fmt(p.promoTickets)} vé`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
