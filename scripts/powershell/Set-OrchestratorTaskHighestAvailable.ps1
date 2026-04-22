# =============================================================
# Set-OrchestratorTaskHighestAvailable.ps1
# Recreates the AIEiji-Orchestrator scheduled task with
# RunLevel=HighestAvailable (requires admin / UAC).
#
# Usage: Run from an *elevated* PowerShell session:
#   pwsh -ExecutionPolicy Bypass -File .\Set-OrchestratorTaskHighestAvailable.ps1
# =============================================================

[CmdletBinding()]
param()

$logFile = 'C:\aieiji-ops\logs\setup_task.log'
function Log { param($msg) Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'HH:mm:ss')] $msg" }
New-Item -ItemType Directory -Force -Path (Split-Path $logFile) | Out-Null
Log "===== START ====="

trap {
    Log "EXCEPTION: $($_.Exception.Message)"
    Log "STACK: $($_.ScriptStackTrace)"
    Write-Host "ERROR — see $logFile"
    Read-Host "Press Enter to exit"
    exit 1
}

$ErrorActionPreference = 'Stop'

# --- Verify admin ---
$currentUser = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Log "Not elevated. WhoAmI=$(whoami)"
    Write-Error "This script must be run from an elevated (Administrator) PowerShell session."
    Read-Host "Press Enter to exit"
    exit 1
}
Log "Admin OK. WhoAmI=$(whoami)"

$taskName = 'AIEiji-Orchestrator'

# Resolve pwsh path (do NOT rely on PATH — admin session may not have user PATH)
$pwshCandidates = @(
    'C:\Program Files\PowerShell\7\pwsh.exe',
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\pwsh.exe",
    'C:\Users\ejsan\AppData\Local\Microsoft\WindowsApps\pwsh.exe'
)
$pwshPath = $pwshCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pwshPath) {
    Log "pwsh.exe not found in any candidate. Tried: $($pwshCandidates -join '; ')"
    throw "pwsh.exe not found"
}
Log "pwshPath=$pwshPath"

$scriptPath = 'C:\aieiji-ops\orchestrator\orchestrator.ps1'

Write-Host "pwsh path : $pwshPath"
Write-Host "script    : $scriptPath"

# --- Remove existing task if present ---
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task '$taskName'..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# --- Build task ---
$action = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File $scriptPath"

$trigger = New-ScheduledTaskTrigger `
    -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 10)

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

$principal = New-ScheduledTaskPrincipal `
    -UserId 'ejsan' `
    -LogonType Interactive `
    -RunLevel Highest
Log "Principal built: UserId=ejsan, RunLevel=Highest"

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal | Out-Null

# --- Verify ---
$task = Get-ScheduledTask -TaskName $taskName
$summary = @"
Task created: $($task.TaskName)
Execute     : $($task.Actions[0].Execute)
Arguments   : $($task.Actions[0].Arguments)
RunLevel    : $($task.Principal.RunLevel)
UserId      : $($task.Principal.UserId)
"@
Write-Host "----"
Write-Host $summary
Log $summary
Log "===== DONE ====="
Read-Host "Press Enter to exit"
