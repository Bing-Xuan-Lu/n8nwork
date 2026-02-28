$taskName = "N8N-Network-Monitor"
$xmlPath  = "D:\Develop\n8nwork\scripts\network-monitor-task.xml"
$vbsPath  = "D:\Develop\n8nwork\scripts\start-network-monitor.vbs"

# Delete existing task
schtasks /delete /tn $taskName /f 2>$null

# Register from XML (supports delay + MultipleInstances IgnoreNew)
schtasks /create /tn $taskName /xml $xmlPath /f
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Task '$taskName' created (30s delay on logon, IgnoreNew)"
    Write-Host "     Log: D:\Develop\n8nwork\logs\network-monitor.log"
} else {
    Write-Host "[FAIL] Please run as Administrator"
    exit 1
}

# Start immediately for this session
Write-Host "Starting network monitor now..."
Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`""
Write-Host "[OK] Started. Check log to confirm."
