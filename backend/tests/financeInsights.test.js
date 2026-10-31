const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// financeInsights nạp kết nối DB khi require; test chỉ dùng hàm thuần nên thay bằng đối tượng rỗng
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request.endsWith('config/database')) return {};
    return originalLoad.call(this, request, ...rest);
};
const insights = require('../src/services/financeInsights');
const { buildRevenueForecast } = require('../src/services/revenueForecast');
Module._load = originalLoad;

const dailyRows = (code, from, to, perDay) => {
    const rows = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
        rows.push({ date: new Date(t).toISOString().slice(0, 10), facility_code: code, revenue: perDay, tickets: 1 });
    }
    return rows;
};

test('nhận diện câu hỏi dự đoán và chi phí', () => {
    assert.ok(insights.detectForecastKeyword('dự đoán tháng sau thế nào'));
    assert.ok(insights.detectForecastKeyword('so với cùng kỳ'));
    assert.ok(!insights.detectForecastKeyword('ai trực hôm nay'));
    assert.ok(insights.detectExpenseKeyword('lợi nhuận tháng 9'));
    assert.ok(insights.detectExpenseKeyword('chi phí cơ sở pq'));
    // "chi tiết" không phải câu hỏi chi phí
    assert.ok(!insights.detectExpenseKeyword('cho xem chi tiết doanh thu'));
});

test('quyền tài chính không gồm ADMIN và quản lý cơ sở', () => {
    for (const role of ['SUPER_ADMIN', 'VICE_PRESIDENT', 'FINANCE_DEPT', 'DEPARTMENT_HEAD']) assert.ok(insights.canReadFinance(role));
    for (const role of ['ADMIN', 'FACILITY_MANAGER', 'SUPERVISOR', undefined]) assert.ok(!insights.canReadFinance(role));
});

test('xác định tháng hỏi chi phí', () => {
    const p = (t) => insights.parseExpenseMonths(t, '2026-10-31', '2026-10');
    assert.deepStrictEqual(p('chi phí tháng 9'), ['2026-09']);
    assert.deepStrictEqual(p('chi phí tháng 9/2025 và tháng 10/2025'), ['2025-09', '2025-10']);
    assert.deepStrictEqual(p('chi phí tháng 3 năm 2025'), ['2025-03']);
    assert.deepStrictEqual(p('chi phí tháng này so với tháng trước'), ['2026-10', '2026-09']);
    assert.deepStrictEqual(p('lợi nhuận thế nào'), ['2026-10']);
    assert.deepStrictEqual(insights.parseExpenseMonths('chi phí tháng trước', '2026-01-05', '2026-01'), ['2025-12']);
    assert.strictEqual(p('tháng 1 tháng 2 tháng 3 tháng 4 tháng 5 chi phí').length, 4);
});

test('khối dự đoán có đủ số, nhận định và cảnh báo', () => {
    const rows = [
        ...dailyRows('41', '2025-11-01', '2025-11-30', 120),
        ...dailyRows('41', '2026-08-01', '2026-10-24', 100),
        ...dailyRows('41', '2026-10-25', '2026-10-31', 70),
    ];
    const text = insights.formatForecastBlock(buildRevenueForecast(rows, { today: '2026-10-31' }));
    assert.match(text, /Mức "bằng" là lệch trong ±3%/);
    assert.match(text, /### 11\/2026/);
    assert.match(text, /GIẢM/);
    assert.match(text, /- 41: 7 ngày tới 2026-10-31 đạt/);
});

test('khối chi phí nói rõ không phải lợi nhuận, gộp loại chi và báo tháng thiếu', () => {
    const text = insights.formatExpenseBlock(['2026-09', '2026-08'], {
        daily: [{ month: '2026-09', facility_code: 'PQ', revenue: 1000, expense: 300, last_date: '2026-09-30' }],
        items: [
            { month: '2026-09', facility_code: 'PQ', category: 'HH dẫn khách', amount: 100 },
            { month: '2026-09', facility_code: 'PQ', category: 'hH dẫn khách', amount: 50 },
            { month: '2026-09', facility_code: 'PQ', category: 'Trái cây', amount: 150 },
        ],
    });
    assert.match(text, /KHÔNG phải lợi nhuận thật/);
    assert.match(text, /doanh thu trừ chi 700/);
    assert.match(text, /\| PQ \| 1\.000 \| 300 \| 150 \| 700 \|/);
    assert.match(text, /HH dẫn khách: 150/);
    assert.ok(!text.includes('hH dẫn khách'));
    assert.match(text, /### 08\/2026\nChưa có file tổng/);
});
