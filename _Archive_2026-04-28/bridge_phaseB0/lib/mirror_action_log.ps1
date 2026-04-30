# =============================================================
# B1: Action_Log mirror
# Append new lines from local Action_Log.md to G Drive Action_Log.md
# =============================================================

function Invoke-ActionLogMirror {
    param(
        [Parameter(Mandatory)][string]$LocalPath,
        [Parameter(Mandatory)][string]$GDrivePath,
        [Parameter(Mandatory)][string]$StateFile
    )

    if (-not (Test-Path -LiteralPath $LocalPath)) {
        Write-Output "[B1] local log not found: $LocalPath"
        return
    }

    $localSize = (Get-Item -LiteralPath $LocalPath).Length
    $lastMirroredSize = $null

    if (Test-Path -LiteralPath $StateFile) {
        try {
            $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
            $lastMirroredSize = [int64]$state.lastSize
        } catch {
            $lastMirroredSize = $null
        }
    }

    # First run semantics: if state missing, seed watermark to current size without dumping.
    # Prevents flooding G Drive Action_Log with historical local content.
    if ($null -eq $lastMirroredSize) {
        @{ lastSize = $localSize; mirroredAt = (Get-Date).ToString('o'); seeded = $true } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
        Write-Output "[B1] seeded state at $localSize bytes (no mirror on first run)"
        return
    }

    if ($localSize -le $lastMirroredSize) {
        Write-Output "[B1] no growth (local=$localSize state=$lastMirroredSize)"
        return
    }

    # Read delta as bytes
    $fs = [System.IO.File]::OpenRead($LocalPath)
    try {
        $null = $fs.Seek($lastMirroredSize, 'Begin')
        $buf = New-Object byte[] ($localSize - $lastMirroredSize)
        $null = $fs.Read($buf, 0, $buf.Length)
    } finally {
        $fs.Dispose()
    }

    $delta = [System.Text.UTF8Encoding]::new($false).GetString($buf)

    # Append to G Drive (UTF-8 no BOM)
    $gdir = Split-Path -Parent $GDrivePath
    if (-not (Test-Path -LiteralPath $gdir)) { New-Item -ItemType Directory -Path $gdir -Force | Out-Null }

    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::AppendAllText($GDrivePath, $delta, $utf8)

    # Update state
    @{ lastSize = $localSize; mirroredAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8

    Write-Output "[B1] mirrored $([math]::Round(($localSize - $lastMirroredSize)/1KB,2)) KB"
}
