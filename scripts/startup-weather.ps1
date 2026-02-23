# n8n 開機天氣推送腳本
# 等待 n8n 啟動完成後，觸發天氣推送 Webhook

$n8nUrl = "http://localhost:5678/webhook/weather-push"
$maxRetries = 10
$retryInterval = 15  # 秒

Write-Host "等待 n8n 啟動..."

for ($i = 1; $i -le $maxRetries; $i++) {
    Start-Sleep -Seconds $retryInterval
    try {
        $response = Invoke-WebRequest -Uri $n8nUrl -Method GET -TimeoutSec 10 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Host "天氣推送成功！"
            break
        }
    } catch {
        Write-Host "第 $i 次嘗試失敗，等待重試..."
    }
}
