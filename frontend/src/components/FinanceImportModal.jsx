import React from 'react';
import { buildDailyReports } from '../utils/financeWorkbook.js';
import { fetchReports, importFinanceWorkbook } from '../services/dataService.js';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));

const LEVEL_STYLE = {
  error: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/40',
  warn: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40',
  info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900/40',
};
const LEVEL_ICON = { error: 'error', warn: 'warning', info: 'info' };

// Xem trước dữ liệu đọc từ file tổng tháng trước khi lưu. Lưu = thay toàn bộ dữ liệu tháng đó.
export default function FinanceImportModal({ parsed, fileName, facilityList, user, onCancel, onDone }) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [hubRevenue, setHubRevenue] = React.useState(null); // { code: tổng doanh thu đang có trên Hub trong tháng }

  const createdBy = user?.name || user?.username || 'Finance Dept';
  const { reports, missing } = React.useMemo(
    () => buildDailyReports(parsed, facilityList, `${createdBy} (File tổng)`),
    [parsed, facilityList, createdBy]
  );

  React.useEffect(() => {
    (async () => {
      const all = await fetchReports();
      const totals = {};
      for (const r of all) {
        if (!String(r.date).startsWith(parsed.month)) continue;
        for (const f of r.data || []) {
          const code = String(f.name || '').toUpperCase().replace(/^DUBAI\s*/, '').trim();
          totals[code] = (totals[code] || 0) + Number(f.revenue || 0);
        }
      }
      setHubRevenue(totals);
    })();
  }, [parsed.month]);

  const codes = parsed.facilities;
  const total = (k) => codes.reduce((a, c) => a + (parsed.summary[c]?.[k] || 0), 0);
  const [y, m] = parsed.month.split('-');
  const errors = parsed.warnings.filter(w => w.level === 'error');

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await importFinanceWorkbook({
        month: parsed.month,
        fileName,
        importedBy: createdBy,
        summary: parsed.summary,
        warnings: parsed.warnings,
        facilities: parsed.facilities,
        daily: parsed.daily,
        tickets: parsed.tickets,
        expenses: parsed.expenses,
        reports,
      });
      if (!res.success) throw new Error(res.error || 'Lưu thất bại');
      onDone(parsed.month);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Lỗi khi lưu dữ liệu');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-fade-in">
      <div className="w-full max-w-6xl bg-white dark:bg-[#121212] rounded-2xl overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col max-h-[92vh]">
        <div className="p-5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1e1e1e]">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-teal-600">upload_file</span>
            Nhập file tổng tháng {m}/{y}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {fileName} · {codes.length} cơ sở · {fmt(parsed.tickets.reduce((a, t) => a + t.ticket_count, 0))} vé · {fmt(parsed.expenses.length)} khoản chi.
            Lưu sẽ <b>thay toàn bộ dữ liệu tháng {m}/{y}</b> của các cơ sở này.
          </p>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-5">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm border border-gray-200 dark:border-gray-800">
              <thead className="bg-[#e2eaf5] dark:bg-blue-900/30 text-gray-700 dark:text-gray-300">
                <tr>
                  {['Cơ sở', 'Số vé', 'Khách', 'Doanh thu vé', 'Chi', 'Lợi nhuận', 'Quẹt thẻ', 'Vé KM', 'Vé 0 đồng', 'Đang có trên Hub', 'Chênh lệch'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-bold whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {codes.map(code => {
                  const s = parsed.summary[code];
                  const hub = hubRevenue ? (hubRevenue[code] || 0) : null;
                  const diff = hub === null ? null : s.revenue - hub;
                  return (
                    <tr key={code} className="border-t border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200">
                      <td className="px-3 py-2 font-bold">{code}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.tickets)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.guests)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-teal-700 dark:text-teal-400">{fmt(s.revenue)}</td>
                      <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{fmt(s.expense)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(s.profit)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.card)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.promoTickets)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.freeTickets)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{hub === null ? '…' : fmt(hub)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${diff ? 'text-amber-600' : 'text-gray-400'}`}>{diff === null ? '' : (diff > 0 ? '+' : '') + fmt(diff)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-gray-300 dark:border-gray-700 font-bold text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a]">
                  <td className="px-3 py-2">Tổng</td>
                  <td className="px-3 py-2 text-right">{fmt(total('tickets'))}</td>
                  <td className="px-3 py-2 text-right">{fmt(total('guests'))}</td>
                  <td className="px-3 py-2 text-right">{fmt(total('revenue'))}</td>
                  <td className="px-3 py-2 text-right">{fmt(total('expense'))}</td>
                  <td className="px-3 py-2 text-right">{fmt(total('profit'))}</td>
                  <td className="px-3 py-2 text-right">{fmt(total('card'))}</td>
                  <td className="px-3 py-2 text-right">{fmt(total('promoTickets'))}</td>
                  <td className="px-3 py-2 text-right">{fmt(total('freeTickets'))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-2">Kiểm tra file ({parsed.warnings.length})</h3>
            {parsed.warnings.length === 0 ? (
              <p className="text-sm text-green-700 dark:text-green-400">Không phát hiện bất thường.</p>
            ) : (
              <ul className="space-y-2">
                {parsed.warnings.map((w, i) => (
                  <li key={i} className={`text-sm border rounded-lg px-3 py-2 flex gap-2 ${LEVEL_STYLE[w.level]}`}>
                    <span className="material-symbols-outlined text-[18px] shrink-0">{LEVEL_ICON[w.level]}</span>
                    <span>{w.facility && <b>{w.facility}: </b>}{w.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {missing.length > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-2">
                Cơ sở {missing.join(', ')} chưa có trên Hub nên không cập nhật vào Heatmap / Nhật ký doanh thu (vẫn lưu ở Đối chiếu tài chính).
              </p>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tinh dầu, khăn, đồ uống được lưu riêng để đối chiếu, không cộng vào doanh thu. Ngày chưa có số liệu không cập nhật vào Heatmap.
          </p>
          {error && <div className="text-sm text-red-600 font-medium">{error}</div>}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-3 bg-gray-50 dark:bg-[#1e1e1e]">
          <button onClick={onCancel} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800">Hủy</button>
          <button
            onClick={handleConfirm}
            disabled={saving || errors.length > 0}
            title={errors.length > 0 ? 'Có lỗi nghiêm trọng, sửa file rồi nhập lại' : ''}
            className="px-5 py-2 rounded-lg text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
            Lưu dữ liệu tháng {m}/{y}
          </button>
        </div>
      </div>
    </div>
  );
}
