# =============================================================
# bridge.ps1 - 1106PC <-> G Drive Bridge (v1.0 Phase B0)
#
# Scheduled every 15 minutes (Phase B2 will register Task Scheduler).
# Phase B0: file-level implementation only. Task NOT registered.
#
# Modules:
#   B1 mirror_action_log  - local Action_Log.md -> G Drive append
#   B2 heartbeat          - write G Drive bridge/heartbeat.json
#   B3 pause_check        - honor G Drive / local PAUSE sentinel
#   B4 drift_detect       - detect social's STATUS.md out-of-band edits
#   B5 session_log        - G Drive session_log.md append
#   B6 daily_digest       - once-per-day Issues snapshot
# =============================================================

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding           = [System.Text.UTF8Encoding]::new($false)

$ErrorActionPreference = 'Stop'

$script:LibDir = Join-Path $PSScriptRoot 'lib'
. (Join-Path $script:LibDir 'config.ps1')
. (Join-Path $script:LibDir 'mirror_action_log.ps1')
. (Join-Path $script:LibDir 'heartbeat.ps1')
. (Join-Path $script:LibDir 'pause_check.ps1')
. (Join-Path $script:LibDir 'drift_detect.ps1')
. (Join-Path $script:LibDir 'session_log.ps1')
. (Join-Path $script:LibDir 'daily_digest.ps1')

# Single-instance guard
$mutex = New-Object System.Threading.Mutex($false, $script:BridgeMutexName)
if (-not $mutex.WaitOne(0)) {
    Write-Output "[bridge] another instance is running; exit"
    exit 0
}

try {
    Write-Output "[bridge] start @ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') on $script:PcName"

    # B3 PAUSE check
    $paused = Test-PauseSentinel -GDrivePauseFile $script:GDrivePauseFile
    if ($paused) {
        Invoke-Heartbeat -GDriveHeartbeat $script:GDriveHeartbeat -HostName $script:HostName -PcName $script:PcName -State 'paused'
        Write-Output "[bridge] PAUSE detected; heartbeat=paused, skip modules"
        exit 0
    }

    # B2 heartbeat (pre)
    Invoke-Heartbeat -GDriveHeartbeat $script:GDriveHeartbeat -HostName $script:HostName -PcName $script:PcName -State 'running'

    # B1 Action_Log mirror
    try {
        Invoke-ActionLogMirror -LocalPath $script:OpsLogPath -GDrivePath $script:GDriveActionLog -StateFile $script:LastMirrorFile
    } catch {
        Write-Output "[B1] ERROR: $_"
    }

    # B4 drift detect
    try {
        Invoke-DriftDetect -GDriveStatusMd $script:GDriveStatusMd
    } catch {
        Write-Output "[B4] ERROR: $_"
    }

    # B5 session log
    try {
        Write-BridgeSessionLog -GDriveSessionLog $script:GDriveSessionLog -PcName $script:PcName -Note 'bridge tick ok'
    } catch {
        Write-Output "[B5] ERROR: $_"
    }

    # B6 daily digest
    try {
        Invoke-DailyDigest -GDriveDigestDir $script:GDriveDigestDir -StateFile $script:LastDigestFile -Repo 'sankaholdings/aieiji-ops'
    } catch {
        Write-Output "[B6] ERROR: $_"
    }

    # B2 heartbeat (post)
    Invoke-Heartbeat -GDriveHeartbeat $script:GDriveHeartbeat -HostName $script:HostName -PcName $script:PcName -State 'idle'

    Write-Output "[bridge] done @ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
