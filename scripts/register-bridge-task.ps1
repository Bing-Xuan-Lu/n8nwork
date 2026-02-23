$taskName = "AI-Bridge-Server"
$vbsPath  = "D:\Develop\n8nwork\scripts\start-bridge.vbs"
$tr       = 'wscript.exe "D:\Develop\n8nwork\scripts\start-bridge.vbs"'

schtasks /delete /tn $taskName /f 2>$null
schtasks /create /tn $taskName /tr $tr /sc ONLOGON /rl HIGHEST /f

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Task created: $taskName"
} else {
    Write-Host "[FAIL] schtasks error: $LASTEXITCODE"
    exit 1
}

Write-Host "Starting bridge server now..."
Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`""
Write-Host "[OK] Bridge server starting on port 3001"
