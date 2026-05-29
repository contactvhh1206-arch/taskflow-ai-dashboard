const fs = require("fs");

let content = fs.readFileSync("server.js", "utf8");

const target = `    if (!targetFacility) {
        // LUỒNG 1: All-Access
        // Áp cột date từ VARCHAR sang DATE để so sánh
        sql = \`SELECT COALESCE(SUM(total_revenue), 0) AS aggregated_revenue 
               FROM daily_financial_reports 
               WHERE date::date >= $1::date AND date::date <= $2::date\`;
        params = [startDate, endDate];
    } else {
        // LUỒNG 2: Local Group
        // Dùng CASE WHEN để chặn lỗi Scalar. Nếu không phải Array, biến nó thành mảng rỗng '[]'
        sql = \`SELECT COALESCE(SUM(
                   (SELECT SUM((item->>'totalRevenue')::numeric) 
                    FROM jsonb_array_elements(
                        CASE 
                            WHEN jsonb_typeof(data) = 'array' THEN data 
                            ELSE '[]'::jsonb 
                        END
                    ) AS item 
                    WHERE REPLACE(UPPER(item->>'facilityCode'), ' ', '') = REPLACE(UPPER($3::text), ' ', '')
                       OR REPLACE(UPPER(item->>'facilityName'), ' ', '') = REPLACE(UPPER($3::text), ' ', ''))
               ), 0) AS aggregated_revenue
               FROM daily_financial_reports
               WHERE date::date >= $1::date AND date::date <= $2::date\`;
        params = [startDate, endDate, targetFacility];
    }`;

const replace = `    if (!targetFacility) {
        // LUỒNG 1: All-Access
        // Ép kiểu chuỗi ngày DD/MM/YYYY sang định dạng Date tiêu chuẩn của PostgreSQL
        sql = \`SELECT COALESCE(SUM(total_revenue), 0) AS aggregated_revenue 
               FROM daily_financial_reports 
               WHERE to_date(date, 'DD/MM/YYYY') >= $1::date AND to_date(date, 'DD/MM/YYYY') <= $2::date\`;
        params = [startDate, endDate];
    } else {
        // LUỒNG 2: Local Group
        // Data là một Object đơn, truy vấn trực tiếp Key không cần array unnesting
        sql = \`SELECT COALESCE(SUM((data->>'totalRevenue')::numeric), 0) AS aggregated_revenue
               FROM daily_financial_reports
               WHERE to_date(date, 'DD/MM/YYYY') >= $1::date AND to_date(date, 'DD/MM/YYYY') <= $2::date
                 AND (REPLACE(UPPER(data->>'facilityCode'), ' ', '') = REPLACE(UPPER($3::text), ' ', '')
                      OR REPLACE(UPPER(data->>'facilityName'), ' ', '') = REPLACE(UPPER($3::text), ' ', ''))\`;
        params = [startDate, endDate, targetFacility];
    }`;

if (content.includes(target)) {
    content = content.replace(target, replace);
    fs.writeFileSync("server.js", content, "utf8");
    console.log("Replaced using JS!");
} else {
    console.log("Target not found!");
}
