$taskName = "N8N-Network-Monitor"
$vbsPath  = "D:\Develop\n8nwork\scripts\start-network-monitor.vbs"
$tr       = 'wscript.exe "D:\Develop\n8nwork\scripts\start-network-monitor.vbs"'

schtasks /delete /tn $taskName /f 2>$null
schtasks /create /tn $taskName /tr $tr /sc ONLOGON /rl HIGHEST /f

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Task created: $taskName"
} else {
    Write-Host "[FAIL] schtasks error: $LASTEXITCODE"
    exit 1
}

Write-Host "Starting network monitor now..."
Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`""
Write-Host "[OK] Network monitor started (logs: D:\Develop\n8nwork\logs\network-monitor.log)"
