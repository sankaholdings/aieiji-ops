# =============================================================
# B2: heartbeat
# Write timestamp, PID, state to G Drive bridge/heartbeat.json
# =============================================================

function Invoke-Heartbeat {
    param(
        [Parameter(Mandatory)][string]$GDriveHeartbeat,
        [Parameter(Mandatory)][string]$HostName,
        [Parameter(Mandatory)][string]$PcName,
        [string]$State = 'running'
    )

    $gdir = Split-Path -Parent $GDriveHeartbeat
    if (-not (Test-Path -LiteralPath $gdir)) { New-Item -ItemType Directory -Path $gdir -Force | Out-Null }

    $hb = [ordered]@{
        pc            = $PcName
        host          = $HostName
        pid           = $PID
        state         = $State
        timestamp     = (Get-Date).ToString('o')
        timezone      = [System.TimeZoneInfo]::Local.Id
        bridgeVersion = '1.0'
    }

    $json = $hb | ConvertTo-Json -Depth 4
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($GDriveHeartbeat, $json, $utf8)

    Write-Output "[B2] heartbeat written (state=$State)"
}
