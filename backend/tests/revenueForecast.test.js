const test = require('node:test');
const assert = require('node:assert');
const { buildRevenueForecast, scoreSnapshots, isTetDay } = require('../src/services/revenueForecast');

// Số giả: mỗi cơ sở thu đều perDay mỗi ngày trong khoảng ngày cho trước
const dailyRows = (code, from, to, perDay, tickets = 0) => {
    const rows = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
        rows.push({ date: new Date(t).toISOString().slice(0, 10), facility_code: code, revenue: perDay, tickets });
    }
    return rows;
};
const core = (from, to, perDay) => ['41', 'ACE', 'PA'].flatMap(c => dailyRows(c, from, to, perDay));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('tháng sau = TB/ngày 3 tháng nền × số ngày khi doanh thu đều', () => {
    const f = buildRevenueForecast(core('2025-07-01', '2026-10-31', 100), { today: '2026-10-31' });
    assert.strictEqual(f.next.month, '2026-11');
    assert.deepStrictEqual(f.next.baseMonths, ['2026-08', '2026-09', '2026-10']);
    close(f.next.seasonalFactor, 1);
    close(f.next.facilities.find(r => r.facility === '41').forecast, 3000);
    close(f.next.chain.forecast, 9000);
    assert.strictEqual(f.next.chain.trend, 'flat');
});

test('hệ số mùa lấy theo 41, ACE, PA của năm trước', () => {
    const rows = [
        ...core('2025-08-01', '2025-10-31', 100),
        ...core('2025-11-01', '2025-11-30', 120),
        ...core('2026-08-01', '2026-10-31', 100),
    ];
    const f = buildRevenueForecast(rows, { today: '2026-10-31' });
    close(f.next.seasonalFactor, 1.2);
    close(f.next.chain.forecast, 3 * 100 * 30 * 1.2);
});

test('tăng, giảm, bằng theo mức cài đặt', () => {
    const rows = [...core('2025-08-01', '2025-11-30', 100), ...core('2026-08-01', '2026-10-31', 95)];
    assert.strictEqual(buildRevenueForecast(rows, { today: '2026-10-31' }).next.chain.trend, 'down');
    assert.strictEqual(buildRevenueForecast(rows, { today: '2026-10-31', flatBandPct: 6 }).next.chain.trend, 'flat');
    const up = [...core('2025-08-01', '2025-11-30', 100), ...core('2026-08-01', '2026-10-31', 110)];
    assert.strictEqual(buildRevenueForecast(up, { today: '2026-10-31' }).next.chain.trend, 'up');
});

test('ngày chưa nhập không tính là 0 đồng', () => {
    const rows = dailyRows('41', '2026-10-01', '2026-10-10', 100).filter(r => r.date !== '2026-10-05');
    rows.push({ date: '2026-10-11', facility_code: '41', revenue: 0 });
    const r = buildRevenueForecast(rows, { today: '2026-10-11' }).current.facilities[0];
    assert.strictEqual(r.daysWithData, 9);
    assert.deepStrictEqual(r.missingDates, ['2026-10-05']);
    close(r.forecast, 3100);
    assert.strictEqual(r.method, 'actual_run_rate');
});

test('dưới 5 ngày số thì dùng công thức mùa, không nhân từ vài ngày đầu', () => {
    const rows = [...core('2026-08-01', '2026-10-31', 100), ...dailyRows('41', '2026-11-01', '2026-11-02', 900)];
    const r = buildRevenueForecast(rows, { today: '2026-11-02' }).current.facilities.find(x => x.facility === '41');
    assert.strictEqual(r.method, 'seasonal');
    close(r.forecast, 3000);
});

test('cơ sở chưa đủ 12 tháng không so với năm trước, toàn chuỗi loại cơ sở đó', () => {
    const rows = [
        ...core('2025-08-01', '2025-11-30', 100),
        ...core('2026-08-01', '2026-10-31', 100),
        ...dailyRows('PAV', '2026-08-01', '2026-10-31', 50),
    ];
    const n = buildRevenueForecast(rows, { today: '2026-10-31' }).next;
    const pav = n.facilities.find(r => r.facility === 'PAV');
    assert.strictEqual(pav.lastYear, null);
    assert.strictEqual(pav.trend, null);
    assert.deepStrictEqual(n.chain.excludedFromComparison, ['PAV']);
    close(n.chain.forecast, 9000 + 1500);
    close(n.chain.yoyPct, 0);
});

test('Tết: 18 ngày quanh mùng 1 và quy đổi 77%', () => {
    assert.strictEqual(isTetDay('2027-01-29'), false);
    assert.strictEqual(isTetDay('2027-01-30'), true);
    assert.strictEqual(isTetDay('2027-02-16'), true);
    assert.strictEqual(isTetDay('2027-02-17'), false);
    const rows = dailyRows('41', '2026-11-01', '2027-01-29', 100);
    const today = '2027-01-29';
    // Hôm nay T01/2027: tháng sau T02/2027 có 16 ngày Tết trong 28 ngày
    const n = buildRevenueForecast(rows, { today }).next;
    assert.strictEqual(n.hasTet, true);
    assert.strictEqual(n.chain.bandPct, 10);
    close(n.facilities[0].forecast, 100 * (12 + 16 * 0.77));
});

test('Tháng nền có Tết không kéo thấp mức ngày thường', () => {
    const rows = dailyRows('41', '2026-02-01', '2026-02-28', 0).concat(
        Array.from({ length: 28 }, (_, i) => {
            const date = `2026-02-${String(i + 1).padStart(2, '0')}`;
            return { date, facility_code: '41', revenue: isTetDay(date) ? 77 : 100 };
        })).filter(r => r.revenue > 0);
    const n = buildRevenueForecast(rows, { today: '2026-02-28' }).next;
    close(n.facilities[0].forecast, 3100);
});

test('mức cần đạt và số vé còn thiếu', () => {
    const rows = [
        ...dailyRows('41', '2025-11-01', '2025-11-30', 120, 1),
        ...dailyRows('41', '2026-08-01', '2026-10-31', 100, 1),
    ];
    const r = buildRevenueForecast(rows, { today: '2026-10-31' }).next.facilities[0];
    close(r.needPerDay, 120);
    close(r.shortTicketsPerDay, 20 / 100);
});

test('không dùng số sau ngày hôm nay', () => {
    const rows = [...dailyRows('41', '2026-10-01', '2026-10-10', 100), ...dailyRows('41', '2026-10-11', '2026-10-20', 900)];
    const r = buildRevenueForecast(rows, { today: '2026-10-10' }).current.facilities[0];
    assert.strictEqual(r.daysWithData, 10);
    close(r.forecast, 3100);
});

test('cảnh báo khi 7 ngày gần nhất tụt từ 20%, không báo khi ổn định', () => {
    const base = dailyRows('41', '2026-09-01', '2026-10-24', 100);
    const quiet = buildRevenueForecast(base.concat(dailyRows('41', '2026-10-25', '2026-10-31', 95)), { today: '2026-10-31' });
    assert.strictEqual(quiet.warnings.length, 0);
    const drop = buildRevenueForecast(base.concat(dailyRows('41', '2026-10-25', '2026-10-31', 70)), { today: '2026-10-31' });
    assert.strictEqual(drop.warnings.length, 1);
    close(drop.warnings[0].changePct, -30);
});

test('không báo tụt trong đợt Tết', () => {
    const rows = dailyRows('41', '2026-01-01', '2026-02-20', 100).map(r => (r.date >= '2026-02-14' ? { ...r, revenue: 50 } : r));
    assert.strictEqual(buildRevenueForecast(rows, { today: '2026-02-20' }).warnings.length, 0);
});

test('chấm điểm lấy bản dự đoán cuối cùng trước ngày đầu tháng', () => {
    const rows = dailyRows('41', '2026-10-01', '2026-10-31', 100);
    const snapshots = [
        { made_on: '2026-09-10', target_month: '2026-10', facility_code: '41', forecast: 2000, low: 1900, high: 2100 },
        { made_on: '2026-09-30', target_month: '2026-10', facility_code: '41', forecast: 3000, low: 2800, high: 3200 },
        { made_on: '2026-10-05', target_month: '2026-10', facility_code: '41', forecast: 9000, low: 8000, high: 9500 },
        { made_on: '2026-10-20', target_month: '2026-11', facility_code: '41', forecast: 1000, low: 900, high: 1100 },
    ];
    const s = scoreSnapshots(snapshots, rows, { today: '2026-11-02' });
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].madeOn, '2026-09-30');
    close(s[0].errorPct, -3.2);
    assert.strictEqual(s[0].withinBand, true);
});
