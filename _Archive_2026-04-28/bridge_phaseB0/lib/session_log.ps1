# =============================================================
# B5: session_log
# Append a line to G Drive session_log.md for 1106PC bridge tick
# =============================================================

function Write-BridgeSessionLog {
    param(
        [Parameter(Mandatory)][string]$GDriveSessionLog,
        [Parameter(Mandatory)][string]$PcName,
        [string]$Note = 'bridge tick'
    )

    $gdir = Split-Path -Parent $GDriveSessionLog
    if (-not (Test-Path -LiteralPath $gdir)) { New-Item -ItemType Directory -Path $gdir -Force | Out-Null }

    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "- [$ts] $PcName bridge | $Note`r`n"

    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::AppendAllText($GDriveSessionLog, $line, $utf8)
}
