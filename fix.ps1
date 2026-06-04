$content = Get-Content -Path "backend\server.js" -Raw
$content = $content -replace 'let final_pic_id = null;', "let final_pic_id = null;`n      let foundPic = null;"
$content = $content -replace 'const foundPic = picCheck\.rows\[0\];', 'foundPic = picCheck.rows[0];'
Set-Content -Path "backend\server.js" -Value $content -Encoding UTF8
Write-Host "Done"
