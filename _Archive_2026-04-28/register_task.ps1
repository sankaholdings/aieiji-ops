$pythonExe = "C:\Users\ejsan\AppData\Local\Programs\Python\Python312\python.exe"
$scriptPath = "C:\aieiji-ops\scripts\python\gmail_thread_watcher.py"

$action = New-ScheduledTaskAction -Execute $pythonExe -Argument $scriptPath
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 30) `
    -RepetitionDuration ([TimeSpan]::MaxValue)

Register-ScheduledTask -TaskName "AIEiji_GmailThreadWatcher" `
    -Action $action -Trigger $trigger -RunLevel Highest -Force | Select-Object TaskName, State

Write-Host "登録完了"
