<#
.SYNOPSIS
    AIEijiCFO 作業ディレクトリおよび INVOX 連携用 Ready_for_Export フォルダを冪等構築する。

.DESCRIPTION
    AIEijiCOO 配下のディレクトリ規約に従い、CFO の作業ツリーと INVOX (Googleドライブ同期)
    との接続口となる Ready_for_Export を構築する。既存ディレクトリは破壊しない（冪等）。

    構築対象:
        C:\ClaudeSync\02_CFO\
        C:\ClaudeSync\02_CFO\Ready_for_Export\
        C:\ClaudeSync\02_CFO\Ready_for_Export\receipts\
        C:\ClaudeSync\02_CFO\Working\
        C:\ClaudeSync\02_CFO\Archive\
        C:\ClaudeSync\00_System\

.PARAMETER Root
    ClaudeSync ルート。既定 C:\ClaudeSync。

.NOTES
    Author : AIEijiSE
    Policy : システム共通絶対ルール準拠 (UI 非使用・PowerShell 背景処理)
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\ClaudeSync'
)

$ErrorActionPreference = 'Stop'

$targets = @(
    (Join-Path $Root '00_System'),
    (Join-Path $Root '02_CFO'),
    (Join-Path $Root '02_CFO\Working'),
    (Join-Path $Root '02_CFO\Ready_for_Export'),
    (Join-Path $Root '02_CFO\Ready_for_Export\receipts'),
    (Join-Path $Root '02_CFO\Archive')
)

$created = New-Object System.Collections.Generic.List[string]
$existed = New-Object System.Collections.Generic.List[string]

foreach ($p in $targets) {
    if (Test-Path -LiteralPath $p) {
        $existed.Add($p)
    } else {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
        $created.Add($p)
    }
}

# Pipeline / Log ファイルが未作成なら雛形を投下（既存は触らない）
$pipelinePath = Join-Path $Root '00_System\Expense_Pipeline.md'
if (-not (Test-Path -LiteralPath $pipelinePath)) {
    @(
        '# Expense_Pipeline',
        '',
        '## 1. Planned',
        '',
        '## 2. Pending',
        '',
        '## 3. Calculated',
        '',
        '## 4. Ready_for_Export',
        ''
    ) | Set-Content -LiteralPath $pipelinePath -Encoding UTF8
    $created.Add($pipelinePath)
}

$logPath = Join-Path $Root '00_System\Action_Log.md'
if (-not (Test-Path -LiteralPath $logPath)) {
    @(
        '# Action_Log',
        ''
    ) | Set-Content -LiteralPath $logPath -Encoding UTF8
    $created.Add($logPath)
}

[pscustomobject]@{
    Root      = $Root
    Created   = $created
    Existed   = $existed
    Timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
}
