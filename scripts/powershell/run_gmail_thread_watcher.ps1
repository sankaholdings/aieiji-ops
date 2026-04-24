# =============================================================
# run_gmail_thread_watcher.ps1
# 役割: gmail_thread_watcher.py を Task Scheduler から定期実行する
#       PowerShell ラッパー（30〜60分間隔で起動する想定）。
# 作成: 2026-04-24 (GitHub Issue #14)
#
# 【実行方法】
#   powershell -NoProfile -ExecutionPolicy Bypass `
#     -File C:\aieiji-ops\scripts\powershell\run_gmail_thread_watcher.ps1
#
# 【出力】
# 同フォルダの gmail_thread_watcher.log に追記。
# Python の終了コードをそのまま伝播する。
# =============================================================

$ErrorActionPreference = 'Continue'

# UTF-8 強制（日本語文字化け防止）
# 子プロセス（python）の stdout/stderr が UTF-8 で出力されるよう、
# コンソールのコードページを 65001 (UTF-8) に切り替えてから .NET の Console エンコーディングも UTF-8 化する。
$null = & chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding           = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONIOENCODING     = 'utf-8'

$base    = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$logFile = Join-Path $PSScriptRoot 'gmail_thread_watcher.log'
$pyExe   = 'C:\Users\ejsan\AppData\Local\Programs\Python\Python312\python.exe'
$script  = Join-Path $base 'scripts\python\gmail_thread_watcher.py'

Set-Location -LiteralPath $base
$env:AIEIJI_BASE_DIR = $base

$PSDefaultParameterValues['Add-Content:Encoding'] = 'UTF8'

Add-Content -LiteralPath $logFile -Value ""
Add-Content -LiteralPath $logFile -Value "========== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =========="
Add-Content -LiteralPath $logFile -Value "BASE   = $base"
Add-Content -LiteralPath $logFile -Value "PYEXE  = $pyExe"
Add-Content -LiteralPath $logFile -Value "SCRIPT = $script"

if (-not (Test-Path -LiteralPath $pyExe)) {
    Add-Content -LiteralPath $logFile -Value "[FATAL] Python 実行ファイルが見つかりません: $pyExe"
    Write-Output "RESULT: FAILED Python executable not found: $pyExe"
    exit 2
}

if (-not (Test-Path -LiteralPath $script)) {
    Add-Content -LiteralPath $logFile -Value "[FATAL] スクリプトが見つかりません: $script"
    Write-Output "RESULT: FAILED Watcher script not found: $script"
    exit 2
}

& $pyExe $script *>&1 | ForEach-Object { Add-Content -LiteralPath $logFile -Value $_ }
$exitCode = $LASTEXITCODE

Add-Content -LiteralPath $logFile -Value "Exit code: $exitCode"

if ($exitCode -eq 0) {
    Write-Output "RESULT: SUCCESS"
} else {
    Write-Output "RESULT: FAILED gmail_thread_watcher.py exited with code $exitCode"
}

exit $exitCode
