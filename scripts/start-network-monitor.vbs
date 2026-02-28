' 防止重複執行：若 network-monitor.js 已在跑則直接退出
Dim objWMI, colProcess
Set objWMI = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
Set colProcess = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE CommandLine LIKE '%network-monitor.js%'")
If colProcess.Count > 0 Then
    WScript.Quit 0
End If

' 啟動 network monitor（隱藏視窗，不等待）
Dim WshShell
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "C:\nvm4w\nodejs\node.exe D:\Develop\n8nwork\bridge\network-monitor.js", 0, False
