$lines = Get-Content server.js -Encoding UTF8

$newLines = @()
for ($i=0; $i -lt 2174; $i++) { $newLines += $lines[$i] }

$newBlock = @'
    if (!targetFacility) {
        // LUỒNG 1: All-Access
        // Ép kiểu chuỗi ngày DD/MM/YYYY sang định dạng Date tiêu chuẩn của PostgreSQL
        sql = \SELECT COALESCE(SUM(total_revenue), 0) AS aggregated_revenue 
               FROM daily_financial_reports 
               WHERE to_date(date, 'DD/MM/YYYY') >= $1::date AND to_date(date, 'DD/MM/YYYY') <= $2::date\;
        params = [startDate, endDate];
    } else {
        // LUỒNG 2: Local Group
        // Data là một Object đơn, truy vấn trực tiếp Key không cần array unnesting
        sql = \SELECT COALESCE(SUM((data->>'totalRevenue')::numeric), 0) AS aggregated_revenue
               FROM daily_financial_reports
               WHERE to_date(date, 'DD/MM/YYYY') >= $1::date AND to_date(date, 'DD/MM/YYYY') <= $2::date
                 AND (REPLACE(UPPER(data->>'facilityCode'), ' ', '') = REPLACE(UPPER($3::text), ' ', '')
                      OR REPLACE(UPPER(data->>'facilityName'), ' ', '') = REPLACE(UPPER($3::text), ' ', ''))\;
        params = [startDate, endDate, targetFacility];
    }
'@

foreach ($line in ($newBlock -split "
")) {
    $newLines += $line
}

for ($i=2200; $i -lt $lines.Length; $i++) { $newLines += $lines[$i] }

$utf8NoBom = New-Object System.Text.UTF8Encoding $False
[IO.File]::WriteAllLines("$PWD\server.js", $newLines, $utf8NoBom)
Write-Host "Success"
