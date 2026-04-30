# =============================================================
# B3: PAUSE sentinel check
# Returns $true if PAUSE file exists on G Drive or locally
# =============================================================

function Test-PauseSentinel {
    param(
        [Parameter(Mandatory)][string]$GDrivePauseFile,
        [string]$LocalPauseFile = 'C:\aieiji-ops\PAUSE'
    )

    if (Test-Path -LiteralPath $LocalPauseFile) {
        Write-Output "[B3] local PAUSE present: $LocalPauseFile"
        return $true
    }

    if (Test-Path -LiteralPath $GDrivePauseFile) {
        Write-Output "[B3] GDrive PAUSE present: $GDrivePauseFile"
        return $true
    }

    return $false
}
