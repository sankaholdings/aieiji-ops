$ErrorActionPreference = 'Continue'
$base = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$logFile = Join-Path $PSScriptRoot 'process_inbox.log'
$pyExe = 'C:\Users\ejsan\AppData\Local\Programs\Python\Python312\python.exe'
$script = Join-Path $PSScriptRoot 'process_inbox.py'

Set-Location -LiteralPath $base
$env:AIEIJI_BASE_DIR = $base
$env:PYTHONIOENCODING = 'utf-8'

Add-Content -LiteralPath $logFile -Value ""
Add-Content -LiteralPath $logFile -Value "========== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =========="
Add-Content -LiteralPath $logFile -Value "BASE = $base"

& $pyExe $script *>&1 | Add-Content -LiteralPath $logFile
$exitCode = $LASTEXITCODE
Add-Content -LiteralPath $logFile -Value "Exit code: $exitCode"
exit $exitCode
