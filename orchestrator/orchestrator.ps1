# =============================================================
# orchestrator.ps1 — aieiji-ops main polling loop
# Invoked by Task Scheduler every 10 minutes.
# =============================================================

[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# --- Force UTF-8 I/O (fixes mojibake from gh CLI on Japanese Windows) ---
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'

# --- Dot-source libs ---
. (Join-Path $PSScriptRoot 'lib\config.ps1')
. (Join-Path $PSScriptRoot 'lib\log.ps1')
. (Join-Path $PSScriptRoot 'lib\chatwork.ps1')
. (Join-Path $PSScriptRoot 'lib\github.ps1')
. (Join-Path $PSScriptRoot 'lib\claude.ps1')

# --- Load .env if present ---
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}

Write-ActionLog -Message "========== orchestrator 起動 =========="

# --- Kill switch ---
if (Test-Path -LiteralPath $script:PauseFilePath) {
    Write-ActionLog -Level WARN -Message "PAUSE ファイル検知 → 処理中断 ($($script:PauseFilePath))"
    exit 0
}

# --- Fetch issues ---
$issues = Get-OpenIssues -Label $script:LabelAutoProcess
Write-ActionLog -Message "対象Issue数: $($issues.Count)"

if ($issues.Count -eq 0) {
    Write-ActionLog -Message "処理対象なし。終了。"
    exit 0
}

$processedCount = 0
$skippedCount   = 0
$failedCount    = 0

foreach ($issue in $issues) {
    $num   = $issue.number
    $title = $issue.title

    # Idempotency: skip if already processed / in-progress
    if ((Test-IssueHasLabel -Issue $issue -Label $script:LabelProcessed) -or
        (Test-IssueHasLabel -Issue $issue -Label $script:LabelInProgress)) {
        Write-ActionLog -Message "Issue #$num スキップ（既処理/処理中）: $title"
        $skippedCount++
        continue
    }

    # Needs-approval: notify Chatwork and skip
    if (Test-IssueHasLabel -Issue $issue -Label $script:LabelNeedsApprove) {
        Write-ActionLog -Level WARN -Message "Issue #$num 承認待ち → Chatwork通知: $title"
        $msg = @"
[info][title]AIEijiSE: 承認待ちIssue[/title]
#$num $title
https://github.com/sankaholdings/aieiji-ops/issues/$num
[/info]
"@
        if (-not $DryRun) { Send-ChatworkMessage -Body $msg | Out-Null }
        $skippedCount++
        continue
    }

    # Process
    Write-ActionLog -Message "Issue #$num 処理開始: $title"
    if ($DryRun) {
        Write-ActionLog -Message "[DRY-RUN] Issue #$num 処理スキップ"
        continue
    }

    Add-IssueLabel -IssueNumber $num -Label $script:LabelInProgress

    try {
        $prompt = @"
GitHub Issue #$num への対応を依頼します。
タイトル: $title

本文:
$($issue.body)

作業完了後、変更はコミット・プッシュしてください。
"@
        $result = Invoke-ClaudeCode -Prompt $prompt

        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $costFmt = if ($result.cost_usd) { '{0:F4}' -f $result.cost_usd } else { '0' }
        $footer  = "`n`n---`n🤖 orchestrator · $ts · cost=`$$costFmt · session=$($result.session_id)"

        if ($result.success) {
            $commentBody = "✅ **処理完了**`n`n$($result.message)$footer"
            Add-IssueComment -IssueNumber $num -Body $commentBody
            Remove-IssueLabel -IssueNumber $num -Label $script:LabelInProgress
            Add-IssueLabel    -IssueNumber $num -Label $script:LabelProcessed
            Write-ActionLog -Message "Issue #$num 処理完了"
            $processedCount++
        } else {
            $commentBody = "❌ **処理失敗**`n`n$($result.message)$footer"
            Add-IssueComment -IssueNumber $num -Body $commentBody
            Remove-IssueLabel -IssueNumber $num -Label $script:LabelInProgress
            Add-IssueLabel    -IssueNumber $num -Label $script:LabelFailed
            Send-ChatworkMessage -Body "[warn]AIEijiSE: Issue #$num 処理失敗[/warn]`n$title`n$($result.message)" | Out-Null
            Write-ActionLog -Level WARN -Message "Issue #$num 処理失敗: $($result.message)"
            $failedCount++
        }

    } catch {
        Write-ActionLog -Level ERROR -Message "Issue #$num 処理失敗: $($_.Exception.Message)"
        Remove-IssueLabel -IssueNumber $num -Label $script:LabelInProgress
        Add-IssueLabel    -IssueNumber $num -Label $script:LabelFailed
        Send-ChatworkMessage -Body "[warn]AIEijiSE: Issue #$num 処理失敗[/warn]`n$title`n$($_.Exception.Message)" | Out-Null
        $failedCount++
    }
}

Write-ActionLog -Message "完了サマリ: 処理=$processedCount / スキップ=$skippedCount / 失敗=$failedCount"
Write-ActionLog -Message "========== orchestrator 終了 =========="
