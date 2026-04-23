# =============================================================
# B6: daily digest
# Emit a one-file daily summary of Issue events to G Drive bridge/digest/YYYY-MM-DD.md
# Runs once per day (guard via last_digest.txt)
# =============================================================

function Invoke-DailyDigest {
    param(
        [Parameter(Mandatory)][string]$GDriveDigestDir,
        [Parameter(Mandatory)][string]$StateFile,
        [Parameter(Mandatory)][string]$Repo
    )

    $today = Get-Date -Format 'yyyy-MM-dd'
    $last = if (Test-Path -LiteralPath $StateFile) { (Get-Content -LiteralPath $StateFile -Raw).Trim() } else { '' }

    if ($last -eq $today) {
        Write-Output "[B6] digest already emitted for $today"
        return
    }

    if (-not (Test-Path -LiteralPath $GDriveDigestDir)) {
        New-Item -ItemType Directory -Path $GDriveDigestDir -Force | Out-Null
    }

    $outPath = Join-Path $GDriveDigestDir "$today.md"

    $header = "# Daily Digest - $today`r`n`r`n"
    $issuesRaw = & gh issue list --repo $Repo --state all --limit 30 --json number,title,state,updatedAt 2>$null
    $body = if ($LASTEXITCODE -eq 0) {
        "## Issues (last 30, all states)`r`n`r`n" + ($issuesRaw -join "`n") + "`r`n"
    } else {
        "## Issues`r`n`r`n(gh CLI unavailable)`r`n"
    }

    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($outPath, $header + $body, $utf8)

    Set-Content -LiteralPath $StateFile -Value $today -Encoding UTF8
    Write-Output "[B6] digest emitted: $outPath"
}
