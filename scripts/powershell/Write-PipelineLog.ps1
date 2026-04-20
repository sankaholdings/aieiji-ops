<#
.SYNOPSIS
    Action_Log.md および Expense_Pipeline.md への打刻・ステータス遷移を行う共通関数群。

.DESCRIPTION
    AIEiji システム共通ログフォーマットに準拠した打刻処理を提供する。
    すべての書き込みは Mutex によりプロセス間排他制御され、半トランザクション性を担保する。

    フォーマット定義:
        Action_Log.md  : "YYYY-MM-DD HH:MM:SS [担当AI名] : [メッセージ]"
        ステータス変更時併記行 :
                         "[PIPELINE_UPDATE] Status changed from X to Y for [ProjectName]"
        Expense_Pipeline.md セクション : "1. Planned" / "2. Pending" / "3. Calculated" / "4. Ready_for_Export"

    使用例:
        . .\Write-PipelineLog.ps1
        Write-ActionLog -Agent 'AIEijiSE' -Message '初期化完了'
        Move-PipelineStatus -ProjectName '三箇栄司_出張旅費_SYC_LOC' -From '3. Calculated' -To '4. Ready_for_Export' -Agent 'AIEijiCFO' -Message '出力ハーネス起動'

.NOTES
    Author : AIEijiSE
#>

$script:AIEijiRoot = 'C:\ClaudeSync'
$script:LogPath      = Join-Path $script:AIEijiRoot '00_System\Action_Log.md'
$script:PipelinePath = Join-Path $script:AIEijiRoot '00_System\Expense_Pipeline.md'
$script:MutexName    = 'Global\AIEiji_Pipeline_Mutex'

$script:ValidStatuses = @(
    '1. Planned',
    '2. Pending',
    '3. Calculated',
    '4. Ready_for_Export'
)

function Invoke-WithMutex {
    param(
        [Parameter(Mandatory)] [scriptblock]$ScriptBlock,
        [int]$TimeoutSec = 30
    )
    $mutex = New-Object System.Threading.Mutex($false, $script:MutexName)
    $acquired = $false
    try {
        $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSec))
        if (-not $acquired) {
            throw "Mutex acquisition timeout ($TimeoutSec sec). Pipeline busy."
        }
        & $ScriptBlock
    }
    finally {
        if ($acquired) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Write-ActionLog {
    <#
    .SYNOPSIS
        Action_Log.md に1行打刻する。
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Agent,
        [Parameter(Mandatory)] [string]$Message,
        [string]$PipelineUpdateLine
    )

    Invoke-WithMutex -ScriptBlock {
        if (-not (Test-Path -LiteralPath $script:LogPath)) {
            New-Item -ItemType File -Path $script:LogPath -Force | Out-Null
            "# Action_Log`r`n" | Add-Content -LiteralPath $script:LogPath -Encoding UTF8
        }

        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $line = "$ts [$Agent] : $Message"
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8

        if ($PSBoundParameters.ContainsKey('PipelineUpdateLine') -and $PipelineUpdateLine) {
            Add-Content -LiteralPath $script:LogPath -Value $PipelineUpdateLine -Encoding UTF8
        }
    }
}

function Move-PipelineStatus {
    <#
    .SYNOPSIS
        Expense_Pipeline.md 内で指定案件を From セクションから To セクションへ移動する。
        併せて Action_Log.md に PIPELINE_UPDATE 行を打刻する。
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$ProjectName,
        [Parameter(Mandatory)] [ValidateScript({ $script:ValidStatuses -contains $_ })] [string]$From,
        [Parameter(Mandatory)] [ValidateScript({ $script:ValidStatuses -contains $_ })] [string]$To,
        [Parameter(Mandatory)] [string]$Agent,
        [string]$Message = "ステータス遷移: $From -> $To"
    )

    Invoke-WithMutex -ScriptBlock {
        if (-not (Test-Path -LiteralPath $script:PipelinePath)) {
            throw "Pipeline file not found: $($script:PipelinePath). Run Initialize-CFODirectory.ps1 first."
        }

        $lines = Get-Content -LiteralPath $script:PipelinePath -Encoding UTF8

        # セクション境界を特定
        $sectionIdx = @{}
        for ($i = 0; $i -lt $lines.Count; $i++) {
            foreach ($s in $script:ValidStatuses) {
                if ($lines[$i] -match "^##\s+$([regex]::Escape($s))\s*$") {
                    $sectionIdx[$s] = $i
                }
            }
        }
        foreach ($s in $script:ValidStatuses) {
            if (-not $sectionIdx.ContainsKey($s)) {
                throw "Pipeline section header missing: '## $s'"
            }
        }

        # From セクション範囲
        $orderedSections = $script:ValidStatuses | Sort-Object { $sectionIdx[$_] }
        $fromStart = $sectionIdx[$From] + 1
        $fromIdxInOrder = [array]::IndexOf($orderedSections, $From)
        if ($fromIdxInOrder -lt ($orderedSections.Count - 1)) {
            $nextSection = $orderedSections[$fromIdxInOrder + 1]
            $fromEnd = $sectionIdx[$nextSection] - 1
        } else {
            $fromEnd = $lines.Count - 1
        }

        # 該当行検出
        $matchPattern = [regex]::Escape($ProjectName)
        $matchedRows = @()
        for ($i = $fromStart; $i -le $fromEnd; $i++) {
            if ($lines[$i] -match $matchPattern) {
                $matchedRows += $i
            }
        }
        if ($matchedRows.Count -eq 0) {
            throw "Project '$ProjectName' not found in section '$From'."
        }

        $movedLines = $matchedRows | ForEach-Object { $lines[$_] }

        # From から削除（後ろから）
        $newLines = New-Object System.Collections.Generic.List[string]
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($matchedRows -notcontains $i) {
                $newLines.Add($lines[$i])
            }
        }

        # To セクション末尾を再特定して挿入
        $sectionIdx2 = @{}
        for ($i = 0; $i -lt $newLines.Count; $i++) {
            foreach ($s in $script:ValidStatuses) {
                if ($newLines[$i] -match "^##\s+$([regex]::Escape($s))\s*$") {
                    $sectionIdx2[$s] = $i
                }
            }
        }
        $orderedSections2 = $script:ValidStatuses | Sort-Object { $sectionIdx2[$_] }
        $toIdxInOrder2 = [array]::IndexOf($orderedSections2, $To)
        if ($toIdxInOrder2 -lt ($orderedSections2.Count - 1)) {
            $nextSection2 = $orderedSections2[$toIdxInOrder2 + 1]
            $insertAt = $sectionIdx2[$nextSection2]
        } else {
            $insertAt = $newLines.Count
        }
        # To セクションヘッダ直後の空行群をスキップして末尾を求める
        $insertPos = $insertAt
        for ($i = $insertAt - 1; $i -gt $sectionIdx2[$To]; $i--) {
            if ([string]::IsNullOrWhiteSpace($newLines[$i])) {
                $insertPos = $i
            } else {
                break
            }
        }

        foreach ($ml in ($movedLines | ForEach-Object { $_ } | Sort-Object -Descending)) {
            $newLines.Insert($insertPos, $ml)
        }

        Set-Content -LiteralPath $script:PipelinePath -Value $newLines -Encoding UTF8

        # ログ打刻
        $updateLine = "[PIPELINE_UPDATE] Status changed from $From to $To for $ProjectName"
        Write-ActionLog -Agent $Agent -Message $Message -PipelineUpdateLine $updateLine
    }
}

function Add-PipelineEntry {
    <#
    .SYNOPSIS
        Expense_Pipeline.md の指定セクションに新規案件行を追加する。
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$ProjectName,
        [Parameter(Mandatory)] [ValidateScript({ $script:ValidStatuses -contains $_ })] [string]$Section,
        [Parameter(Mandatory)] [string]$Agent,
        [datetime]$Date = (Get-Date)
    )

    Invoke-WithMutex -ScriptBlock {
        if (-not (Test-Path -LiteralPath $script:PipelinePath)) {
            throw "Pipeline file not found: $($script:PipelinePath)"
        }
        $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $script:PipelinePath -Encoding UTF8)
        $sectionIdx = -1
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match "^##\s+$([regex]::Escape($Section))\s*$") {
                $sectionIdx = $i; break
            }
        }
        if ($sectionIdx -lt 0) { throw "Section '$Section' not found." }

        $entry = "- [ ] $($Date.ToString('yyyy/MM/dd')): $ProjectName (担当: $Agent)"
        $lines.Insert($sectionIdx + 1, $entry)
        Set-Content -LiteralPath $script:PipelinePath -Value $lines -Encoding UTF8

        Write-ActionLog -Agent $Agent -Message "Pipeline entry 追加: [$Section] $ProjectName"
    }
}
