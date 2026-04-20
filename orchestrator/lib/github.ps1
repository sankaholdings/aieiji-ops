# =============================================================
# github.ps1 — gh CLI wrapper
# =============================================================

function Get-OpenIssues {
    [CmdletBinding()]
    param(
        [string]$Label = $script:LabelAutoProcess,
        [int]$Limit = 20
    )
    try {
        $raw = & gh issue list --repo $script:GitHubRepo --state open --label $Label --limit $Limit --json number,title,body,labels,author,createdAt 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-ActionLog -Level ERROR -Message "gh issue list 失敗 (exit=$LASTEXITCODE)"
            return @()
        }
        $json = if ($raw -is [array]) { $raw -join "`n" } else { [string]$raw }
        if ([string]::IsNullOrWhiteSpace($json)) { return @() }
        $result = $json | ConvertFrom-Json
        return @($result)
    } catch {
        Write-ActionLog -Level ERROR -Message "gh issue list 例外: $($_.Exception.Message)"
        return @()
    }
}

function Test-IssueHasLabel {
    param(
        $Issue,
        [string]$Label
    )
    if ($null -eq $Issue -or $null -eq $Issue.labels) { return $false }
    foreach ($lbl in @($Issue.labels)) {
        if ($lbl.name -eq $Label) { return $true }
    }
    return $false
}

function Add-IssueLabel {
    param(
        [int]$IssueNumber,
        [string]$Label
    )
    & gh issue edit $IssueNumber --repo $script:GitHubRepo --add-label $Label 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-ActionLog -Level WARN -Message "Issue #$IssueNumber にラベル '$Label' 追加失敗 (exit=$LASTEXITCODE)"
    }
}

function Remove-IssueLabel {
    param(
        [int]$IssueNumber,
        [string]$Label
    )
    & gh issue edit $IssueNumber --repo $script:GitHubRepo --remove-label $Label 2>$null | Out-Null
}

function Add-IssueComment {
    param(
        [int]$IssueNumber,
        [string]$Body
    )
    $Body | & gh issue comment $IssueNumber --repo $script:GitHubRepo --body-file - 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-ActionLog -Level WARN -Message "Issue #$IssueNumber へのコメント失敗 (exit=$LASTEXITCODE)"
    }
}
