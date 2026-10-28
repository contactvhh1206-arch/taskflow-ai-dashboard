// Bộ đọc file tổng tháng của kế toán (TỔNG Txx.xlsx).
// Mỗi cơ sở có 3 sheet: "N.DT-xx" (tổng theo ngày), "N.VÉ-xx" (mỗi dòng 1 vé), "N.CHIxx" (từng khoản chi).
// Các cơ sở xếp cột khác nhau nên luôn dò cột theo tên tiêu đề, không theo vị trí.
// Tinh dầu, khăn, đồ uống là hàng bán kèm: chỉ ghi để đối chiếu, KHÔNG cộng vào doanh thu.
// Hàm thuần, nhận thư viện SheetJS (window.XLSX) làm tham số để chạy được cả ngoài trình duyệt.

// Hậu tố tên sheet → mã cơ sở trên Hub
export const SHEET_SUFFIX_TO_FACILITY = { '41': '41', 'ACE': 'ACE', 'PQ': 'PQ', 'PA': 'PA', 'PAV': 'PAV', '01': 'PAK' };

// Tiêu đề cột hàng bán kèm → tên hiển thị thống nhất
const ADDON_HEADERS = {
  'TD': 'Tinh dầu', 'TINH DẦU': 'Tinh dầu', 'KHĂN': 'Khăn',
  'SUỐI': 'Suối', 'COCA': 'Coca', 'BÒ CỤNG': 'Bò cụng', 'OLONG': 'Olong', 'BIA': 'Bia', 'YẾN': 'Yến',
  'BÒ KHO': 'Bò kho', 'GÀ ÁC': 'Gà ác', 'MÌ': 'Mì', 'BÒ': 'Bò', 'TRỨNG': 'Trứng',
};

const norm = (v) => (v === null || v === undefined ? '' : String(v).normalize('NFC').replace(/\s+/g, ' ').trim().toUpperCase());
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.replace(/,/g, '')))) return Number(v.replace(/,/g, ''));
  return 0;
};
const pad = (n) => String(n).padStart(2, '0');

// Phân loại cột KM: 20/30/100 = giảm %, -200 = trừ tiền, CB = combo, HH = môi giới hoa hồng (không phải giảm giá)
export const kmKind = (km) => {
  const s = norm(km);
  if (!s) return '';
  if (/^-\d+(\.\d+)?$/.test(s)) return 'amount';
  if (/^\d+(\.\d+)?$/.test(s)) return 'percent';
  if (s.startsWith('CB')) return 'combo';
  if (s.startsWith('HH')) return 'commission';
  return 'other';
};

// Ô ngày có thể là số serial Excel, Date, "dd/mm/yyyy" hoặc "dd/mm" (sheet DT). Trả "YYYY-MM-DD" hoặc null.
const toIsoDate = (XLSX, v, fallbackYear) => {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : fallbackYear;
      if (!y) return null;
      return `${y}-${pad(m[2])}-${pad(m[1])}`;
    }
  }
  return null;
};

const sheetRows = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });

// Tìm dòng tiêu đề trong 15 dòng đầu: dòng chứa đủ các tên cột bắt buộc. Trả {row, cols: {TÊN: chỉ số cột đầu tiên}}.
const findHeader = (rows, required) => {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols = {};
    (rows[r] || []).forEach((h, i) => {
      const k = norm(h);
      if (k && cols[k] === undefined) cols[k] = i;
    });
    if (required.every(k => cols[k] !== undefined)) return { row: r, cols };
  }
  return null;
};

// Danh mục chi phí lấy từ sheet "TỔNG (DT+CP)" (cột HẠN MỤC), để phát hiện khoản chi ghi sai loại
const readExpenseCategories = (XLSX, wb) => {
  const name = wb.SheetNames.find(n => norm(n).startsWith('TỔNG'));
  if (!name) return null;
  const rows = sheetRows(XLSX, wb.Sheets[name]);
  const hdr = findHeader(rows, ['HẠN MỤC']);
  if (!hdr) return null;
  const c = hdr.cols['HẠN MỤC'];
  const skip = new Set(['TỔNG DOANH THU', 'DOANH THU BÁN VÉ', 'CHI PHÍ PHÁT SINH']);
  const cats = new Set();
  for (let r = hdr.row + 1; r < rows.length; r++) {
    const v = norm(rows[r]?.[c]);
    if (v === 'LỢI NHUẬN') break;
    if (v && !skip.has(v)) cats.add(v);
  }
  return cats.size ? cats : null;
};

export function parseFinanceWorkbook(XLSX, wb, { prices = [], promoCodes = [] } = {}) {
  const warnings = [];
  const warn = (level, facility, message) => warnings.push({ level, facility, message });

  // 1. Nhóm sheet theo cơ sở
  const groups = {};
  for (const name of wb.SheetNames) {
    const m = norm(name).match(/^\d+\s*\.\s*(DT|VÉ|VE|CHI)\s*-?\s*(.+)$/);
    if (!m) continue;
    const kind = m[1] === 'VE' ? 'VÉ' : m[1];
    const suffix = m[2].trim();
    const code = SHEET_SUFFIX_TO_FACILITY[suffix] || suffix;
    if (!SHEET_SUFFIX_TO_FACILITY[suffix]) warn('warn', code, `Sheet "${name}": hậu tố "${suffix}" chưa có trong bảng ghép cơ sở, tạm dùng mã "${code}".`);
    (groups[code] = groups[code] || {})[kind] = name;
  }
  const facilities = Object.keys(groups).filter(code => groups[code]['VÉ']);
  if (facilities.length === 0) {
    throw new Error('Không tìm thấy sheet vé nào dạng "1.VÉ-41". File có đúng là file tổng tháng không?');
  }
  for (const code of Object.keys(groups)) {
    for (const kind of ['DT', 'VÉ', 'CHI']) {
      if (!groups[code][kind]) warn('warn', code, `Thiếu sheet ${kind} của cơ sở ${code}.`);
    }
  }

  // 2. Xác định tháng: tháng xuất hiện nhiều nhất trong cột NGÀY của các sheet vé
  const monthVotes = {};
  const veSheets = {};
  for (const code of facilities) {
    const rows = sheetRows(XLSX, wb.Sheets[groups[code]['VÉ']]);
    const hdr = findHeader(rows, ['NGÀY', 'LOẠI VÉ', 'TỔNG VÉ SAU KM']);
    if (!hdr) {
      warn('error', code, `Sheet "${groups[code]['VÉ']}": không tìm thấy dòng tiêu đề có NGÀY, Loại vé, Tổng Vé sau KM. Bỏ qua cơ sở này.`);
      continue;
    }
    veSheets[code] = { rows, hdr };
    for (let r = hdr.row + 1; r < rows.length; r++) {
      const d = toIsoDate(XLSX, rows[r]?.[hdr.cols['NGÀY']], null);
      if (d) monthVotes[d.slice(0, 7)] = (monthVotes[d.slice(0, 7)] || 0) + 1;
    }
  }
  const month = Object.entries(monthVotes).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!month) throw new Error('Không đọc được ngày nào trong các sheet vé.');
  const year = month.slice(0, 4);

  const priceMap = Object.fromEntries(prices.map(p => [norm(p.ticket_type), Number(p.list_price)]));
  const codeSet = new Set(promoCodes.map(c => norm(c.code)));
  const categories = readExpenseCategories(XLSX, wb);

  const daily = {};     // `${date}|${code}` → dòng finance_daily
  const tickets = {};   // `${date}|${code}|${type}|${promo}|${km}` → dòng finance_ticket_daily
  const expenses = [];
  const unknownTypes = {};
  const unknownCodes = {};
  const dayRow = (date, code) => (daily[`${date}|${code}`] = daily[`${date}|${code}`] || {
    date, facility_code: code, ticket_count: 0, guest_count: 0, ticket_revenue: 0, expense: 0, card_amount: 0, addons: {},
  });
  const outOfMonth = (code, sheet, n) => n && warn('warn', code, `Sheet "${sheet}": ${n} dòng có ngày ngoài tháng ${month}, đã bỏ qua.`);

  // 3. Sheet vé
  for (const code of Object.keys(veSheets)) {
    const { rows, hdr } = veSheets[code];
    const c = hdr.cols;
    const sheet = groups[code]['VÉ'];
    const addonCols = Object.entries(ADDON_HEADERS).filter(([h]) => c[h] !== undefined).map(([h, label]) => [c[h], label]);
    const guestCol = c['SL KHÁCH'];
    const cardCol = c['QUẸT THẺ'];
    let skippedOut = 0, noDate = 0, noType = 0, noTypeMoney = 0;
    for (let r = hdr.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const type = norm(row[c['LOẠI VÉ']]);
      const net = num(row[c['TỔNG VÉ SAU KM']]);
      const rawDate = row[c['NGÀY']];
      const card = cardCol !== undefined ? num(row[cardCol]) : 0;
      if (!type && !net) {
        // Kế toán thường ghi tổng quẹt thẻ cả ngày trên một dòng riêng không có vé
        const cardDate = card ? toIsoDate(XLSX, rawDate, year) : null;
        if (cardDate && cardDate.startsWith(month)) dayRow(cardDate, code).card_amount += card;
        continue;
      }
      const date = toIsoDate(XLSX, rawDate, year);
      if (!date) { noDate++; continue; }
      if (!date.startsWith(month)) { skippedOut++; continue; }
      if (!type) { noType++; noTypeMoney += net; }
      const promo = c['CODE'] !== undefined ? norm(row[c['CODE']]) : '';
      const km = c['KM'] !== undefined ? norm(row[c['KM']]) : '';
      const guests = guestCol !== undefined ? num(row[guestCol]) : 0;

      const d = dayRow(date, code);
      d.ticket_count += 1;
      d.guest_count += guests;
      d.ticket_revenue += net;
      d.card_amount += card;
      for (const [col, label] of addonCols) {
        const q = num(row[col]);
        if (q) d.addons[label] = (d.addons[label] || 0) + q;
      }

      const key = `${date}|${code}|${type}|${promo}|${km}`;
      const t = (tickets[key] = tickets[key] || {
        date, facility_code: code, ticket_type: type, promo_code: promo, km, km_kind: kmKind(km),
        ticket_count: 0, guest_count: 0, revenue: 0, free_count: 0,
      });
      t.ticket_count += 1;
      t.guest_count += guests;
      t.revenue += net;
      if (net === 0) t.free_count += 1;

      if (type && priceMap[type] === undefined) unknownTypes[type] = (unknownTypes[type] || 0) + 1;
      if (promo && !codeSet.has(promo)) unknownCodes[promo] = (unknownCodes[promo] || 0) + 1;
    }
    outOfMonth(code, sheet, skippedOut);
    if (noDate) warn('warn', code, `Sheet "${sheet}": ${noDate} vé không đọc được ngày, đã bỏ qua.`);
    if (noType) warn('warn', code, `Sheet "${sheet}": ${noType} vé không ghi loại vé (tổng ${noTypeMoney.toLocaleString('vi-VN')}).`);
  }

  // 4. Sheet chi
  for (const code of facilities) {
    const sheet = groups[code]['CHI'];
    if (!sheet) continue;
    const rows = sheetRows(XLSX, wb.Sheets[sheet]);
    const hdr = findHeader(rows, ['NGÀY', 'THÀNH TIỀN']);
    if (!hdr) { warn('error', code, `Sheet "${sheet}": không tìm thấy tiêu đề NGÀY, THÀNH TIỀN.`); continue; }
    const c = hdr.cols;
    let skippedOut = 0, noDate = 0;
    const badCats = {};
    for (let r = hdr.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const amount = num(row[c['THÀNH TIỀN']]);
      if (!amount) continue;
      const date = toIsoDate(XLSX, row[c['NGÀY']], year);
      if (!date) { noDate++; continue; }
      if (!date.startsWith(month)) { skippedOut++; continue; }
      const category = c['LOẠI CHI PHÍ'] !== undefined ? String(row[c['LOẠI CHI PHÍ']] ?? '').trim() : '';
      const description = c['NỘI DUNG'] !== undefined ? String(row[c['NỘI DUNG']] ?? '').trim() : '';
      expenses.push({ date, facility_code: code, description, amount, category });
      dayRow(date, code).expense += amount;
      if (categories && !categories.has(norm(category))) {
        const k = category || '(trống)';
        (badCats[k] = badCats[k] || []).push(`${date.slice(8)}/${date.slice(5, 7)} "${description}" ${amount.toLocaleString('vi-VN')}`);
      }
    }
    outOfMonth(code, sheet, skippedOut);
    if (noDate) warn('warn', code, `Sheet "${sheet}": ${noDate} khoản chi không đọc được ngày, đã bỏ qua.`);
    for (const [cat, items] of Object.entries(badCats)) {
      warn('warn', code, `Loại chi phí "${cat}" không có trong danh mục của sheet TỔNG: ${items.slice(0, 3).join('; ')}${items.length > 3 ? ` (+${items.length - 3})` : ''}.`);
    }
  }

  // 5. Đối chiếu với sheet DT (cột VÉ và CHI theo ngày do công thức Excel tính)
  for (const code of facilities) {
    const sheet = groups[code]['DT'];
    if (!sheet) continue;
    const rows = sheetRows(XLSX, wb.Sheets[sheet]);
    const hdr = findHeader(rows, ['NGÀY', 'VÉ', 'CHI']);
    if (!hdr) { warn('warn', code, `Sheet "${sheet}": không tìm thấy tiêu đề NGÀY, VÉ, CHI để đối chiếu.`); continue; }
    const c = hdr.cols;
    const diffs = [];
    for (let r = hdr.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const date = toIsoDate(XLSX, row[c['NGÀY']], year);
      if (!date || !date.startsWith(month)) continue;
      const d = daily[`${date}|${code}`] || { ticket_revenue: 0, expense: 0 };
      const dtVe = num(row[c['VÉ']]), dtChi = num(row[c['CHI']]);
      if (Math.abs(dtVe - d.ticket_revenue) > 0.5) diffs.push(`${date.slice(8)}/${date.slice(5, 7)} vé: DT ${dtVe.toLocaleString('vi-VN')} ≠ VÉ ${d.ticket_revenue.toLocaleString('vi-VN')}`);
      if (Math.abs(dtChi - d.expense) > 0.5) diffs.push(`${date.slice(8)}/${date.slice(5, 7)} chi: DT ${dtChi.toLocaleString('vi-VN')} ≠ CHI ${d.expense.toLocaleString('vi-VN')}`);
    }
    if (diffs.length) warn('warn', code, `Sheet "${sheet}" lệch với dữ liệu gốc: ${diffs.slice(0, 4).join('; ')}${diffs.length > 4 ? ` (+${diffs.length - 4})` : ''}.`);
  }

  if (Object.keys(unknownTypes).length) {
    warn('info', '', `Loại vé chưa có giá niêm yết (không ước tính được tiền giảm): ${Object.entries(unknownTypes).map(([t, n]) => `${t} (${n})`).join(', ')}.`);
  }
  if (Object.keys(unknownCodes).length) {
    warn('info', '', `Mã khuyến mãi chưa đặt tên: ${Object.entries(unknownCodes).map(([t, n]) => `${t} (${n})`).join(', ')}.`);
  }

  // 6. Tổng theo cơ sở
  const dailyRows = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date) || a.facility_code.localeCompare(b.facility_code));
  const ticketRows = Object.values(tickets);
  const summary = {};
  for (const code of facilities) {
    const ds = dailyRows.filter(d => d.facility_code === code);
    const ts = ticketRows.filter(t => t.facility_code === code);
    const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
    summary[code] = {
      tickets: sum(ds, 'ticket_count'),
      guests: sum(ds, 'guest_count'),
      revenue: sum(ds, 'ticket_revenue'),
      expense: sum(ds, 'expense'),
      profit: sum(ds, 'ticket_revenue') - sum(ds, 'expense'),
      card: sum(ds, 'card_amount'),
      promoTickets: sum(ts.filter(t => t.promo_code || ['percent', 'amount', 'combo'].includes(t.km_kind)), 'ticket_count'),
      freeTickets: sum(ts, 'free_count'),
      days: new Set(ds.filter(d => d.ticket_revenue > 0).map(d => d.date)).size,
    };
  }

  return { month, facilities, daily: dailyRows, tickets: ticketRows, expenses, summary, warnings };
}

// Bản ghi cho bảng daily_financial_reports (Heatmap, Nhật ký doanh thu, Cố vấn AI): một dòng mỗi ngày,
// mảng data theo danh sách cơ sở của Hub. Ngày mà mọi cơ sở đều 0 thì bỏ qua (ngày chưa có số).
export function buildDailyReports(parsed, facilityList, createdBy) {
  const byCode = {};
  for (const f of facilityList || []) {
    const short = norm(f.name).replace(/^DUBAI\s*/, '');
    byCode[short] = f;
  }
  const dates = [...new Set(parsed.daily.map(d => d.date))].sort();
  const now = Date.now();
  const reports = [];
  for (const date of dates) {
    const rows = parsed.daily.filter(d => d.date === date);
    const total = rows.reduce((a, d) => a + d.ticket_revenue, 0);
    if (total === 0) continue;
    const data = parsed.facilities
      .filter(code => byCode[code])
      .map(code => ({
        id: byCode[code].id,
        name: byCode[code].name,
        revenue: rows.find(d => d.facility_code === code)?.ticket_revenue || 0,
        note: 'Nhập file tổng',
      }));
    reports.push({
      id: `rep_${now}_${date}`,
      date,
      createdBy,
      timestamp: now,
      totalRevenue: data.reduce((a, d) => a + d.revenue, 0),
      data,
    });
  }
  const missing = parsed.facilities.filter(code => !byCode[code]);
  return { reports, missing };
}
