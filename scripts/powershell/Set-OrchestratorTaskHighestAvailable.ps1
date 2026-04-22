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

$ErrorActionPreference = 'Stop'

# --- Verify admin ---
$currentUser = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run from an elevated (Administrator) PowerShell session."
    exit 1
}

$taskName = 'AIEiji-Orchestrator'
$pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
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
    -UserId (whoami) `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal | Out-Null

# --- Verify ---
$task = Get-ScheduledTask -TaskName $taskName
Write-Host "----"
Write-Host "Task created: $($task.TaskName)"
Write-Host "Execute     : $($task.Actions[0].Execute)"
Write-Host "Arguments   : $($task.Actions[0].Arguments)"
Write-Host "RunLevel    : $($task.Principal.RunLevel)"
Write-Host "UserId      : $($task.Principal.UserId)"
Write-Host "Done."
