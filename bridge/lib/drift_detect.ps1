# =============================================================
# B4: Drift detection
# Detect social's edits to STATUS.md on G Drive side (out-of-band changes)
# Phase B0: detection only (log to console). Ingestion is B1+ mirror direction.
# =============================================================

function Invoke-DriftDetect {
    param(
        [Parameter(Mandatory)][string]$GDriveStatusMd
    )

    if (-not (Test-Path -LiteralPath $GDriveStatusMd)) {
        Write-Output "[B4] G Drive STATUS.md not found"
        return
    }

    $item = Get-Item -LiteralPath $GDriveStatusMd
    $age = (Get-Date) - $item.LastWriteTime
    $ageMin = [math]::Round($age.TotalMinutes, 1)

    Write-Output "[B4] STATUS.md last modified $ageMin min ago (size=$($item.Length))"
}
