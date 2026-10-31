const test = require('node:test');
const assert = require('node:assert');
const { buildRevenueSources, groupOfTicket, normalizeCode } = require('../src/services/revenueSources');

const services = new Set(['MS', 'LG']);
const group = (ticket_type, promo_code = '', km_kind = '') => groupOfTicket({ ticket_type, promo_code, km_kind }, services);
const row = (month, facility_code, ticket_type, promo_code, km_kind, revenue, ticket_count = 1) =>
    ({ month, facility_code, ticket_type, promo_code, km_kind, revenue, ticket_count });

test('chuẩn hóa mã: bỏ dấu, khoảng trắng', () => {
    assert.strictEqual(normalizeCode('A TÙNG'), 'ATUNG');
    assert.strictEqual(normalizeCode('GG MAP'), 'GGMAP');
    assert.strictEqual(normalizeCode('BĐ'), 'BD');
});

test('xếp vé vào đúng nhóm', () => {
    assert.strictEqual(group('D'), 'direct');
    assert.strictEqual(group('D', '', 'commission'), 'commission');
    assert.strictEqual(group('D', 'CM', 'percent'), 'camapro');
    assert.strictEqual(group('D', 'CM20', 'percent'), 'camapro');
    assert.strictEqual(group('D', 'VIP10', 'percent'), 'gift');
    assert.strictEqual(group('D', 'GG MAP', 'percent'), 'maps');
    assert.strictEqual(group('D', 'GGMAP', 'percent'), 'maps');
    assert.strictEqual(group('D', 'BĐ', 'percent'), 'football');
    assert.strictEqual(group('D', 'AT30', 'percent'), 'manager');
    assert.strictEqual(group('D', 'A TÙNG', 'percent'), 'manager');
    assert.strictEqual(group('D', 'QL', 'percent'), 'manager');
    assert.strictEqual(group('D', 'CB1', 'percent'), 'combo');
    assert.strictEqual(group('D', '', 'combo'), 'combo');
    assert.strictEqual(group('D', '', 'amount'), 'desk');
    assert.strictEqual(group('D', '', 'percent'), 'other_discount');
    assert.strictEqual(group('D', 'VQ', 'percent'), 'other_code');
    assert.strictEqual(group('MS'), 'service');
    assert.strictEqual(group('', '', ''), 'surplus');
    assert.strictEqual(group('CMX', '', ''), 'direct');
});

test('tổng các nhóm bằng doanh thu, dịch vụ và tiền dư không đếm vé', () => {
    const rows = [
        row('2026-10', '41', 'D', '', '', 900),
        row('2026-10', '41', 'D', 'CM', 'percent', 100),
        row('2026-10', 'PQ', 'MS', '', '', 300, 2),
        row('2026-10', 'PQ', '', '', '', 50, 1),
    ];
    const r = buildRevenueSources(rows, [], { month: '2026-10', serviceTypes: ['MS'] });
    assert.strictEqual(r.chain.totalRevenue, 1350);
    assert.strictEqual(r.chain.groups.reduce((a, g) => a + g.revenue, 0), 1350);
    assert.strictEqual(r.chain.groups[0].key, 'direct');
    assert.strictEqual(r.chain.groups[0].sharePct, 66.7);
    assert.strictEqual(r.chain.groups.find(g => g.key === 'service').tickets, null);
    assert.strictEqual(r.byFacility.PQ.totalRevenue, 350);
});

test('so năm trước theo TB/ngày, chỉ trên cơ sở có đủ số cả hai năm', () => {
    const rows = [
        row('2026-10', '41', 'D', 'CM', 'percent', 1100),
        row('2026-10', 'PAV', 'D', 'CM', 'percent', 5000),
        row('2025-10', '41', 'D', 'CM', 'percent', 3100),
    ];
    const days = [
        { month: '2026-10', facility_code: '41', days: 10 },
        { month: '2026-10', facility_code: 'PAV', days: 10 },
        { month: '2025-10', facility_code: '41', days: 31 },
    ];
    const r = buildRevenueSources(rows, days, { month: '2026-10' });
    assert.deepStrictEqual(r.chain.comparedFacilities, ['41']);
    assert.strictEqual(r.chain.groups[0].yoyPct, 10);
    assert.strictEqual(r.byFacility.PAV.groups[0].yoyPct, null);
});

test('không so năm trước nhóm hoa hồng, tự đến khi năm trước chưa ghi HH', () => {
    const rows = [
        row('2026-09', '41', 'D', '', '', 100),
        row('2026-09', '41', 'D', '', 'commission', 50),
        row('2026-09', '41', 'D', 'CM', 'percent', 20),
        row('2025-09', '41', 'D', '', '', 100),
        row('2025-09', '41', 'D', 'CM', 'percent', 10),
        row('2027-09', '41', 'D', '', '', 110),
        row('2026-09', '41', 'D', '', '', 0),
    ];
    const days = ['2025-09', '2026-09', '2027-09'].map(month => ({ month, facility_code: '41', days: 30 }));
    const r = buildRevenueSources(rows, days, { month: '2026-09' });
    assert.strictEqual(r.chain.groups.find(g => g.key === 'direct').yoyPct, null);
    assert.strictEqual(r.chain.groups.find(g => g.key === 'commission').yoyPct, null);
    assert.strictEqual(r.chain.groups.find(g => g.key === 'camapro').yoyPct, 100);
    assert.strictEqual(r.commissionNotComparable, true);
    assert.strictEqual(r.commissionNotMarked, false);
    const later = buildRevenueSources(rows, days, { month: '2027-09' });
    assert.strictEqual(later.chain.groups.find(g => g.key === 'direct').yoyPct, 10);
    assert.strictEqual(later.commissionNotComparable, false);
    assert.strictEqual(buildRevenueSources(rows, days, { month: '2025-09' }).commissionNotMarked, true);
});

test('nhóm năm trước không có thì không tính phần trăm', () => {
    const rows = [
        row('2026-10', '41', 'D', 'CM', 'percent', 100),
        row('2025-10', '41', 'D', '', '', 100),
    ];
    const days = [{ month: '2026-10', facility_code: '41', days: 30 }, { month: '2025-10', facility_code: '41', days: 31 }];
    assert.strictEqual(buildRevenueSources(rows, days, { month: '2026-10' }).chain.groups[0].yoyPct, null);
});
