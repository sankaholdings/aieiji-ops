<#
.SYNOPSIS
    出張旅費請求書の計算ロジック（SYC・LOC両エンティティ対応）を Excel 非依存で実行する計算脳。

.DESCRIPTION
    『出張旅費請求書 (三箇栄司SYC_LOC両方).xlsx』から抽出した SYC（HKC含む）/ LOC 両エンティティの
    宿泊料・日当・規程地域別単価・NETWORKDAYS.INTL 相当の日数算定ロジックを PowerShell 内部演算として
    完全実装する。Excel・LibreOffice 等の表計算 GUI を一切起動せずバックグラウンドで完結する。

    両エンティティ規程テーブル:

      SYC (HKC含む / 医療法人系) — 役職: 事務長
          宿泊料  : 全地域一律 23,000 円/泊
          日当    : 海外 80,000 / 甲地 40,000 / 乙地 32,000 円/日

      LOC (有限会社エルオーシー・テイカ) — 役職: 代表取締役
          宿泊料  : 全地域一律 18,000 円/泊
          日当    : 海外 50,000 / 甲地 30,000 / 乙地 25,000 円/日

    日数算定: NETWORKDAYS.INTL(B, H, "0000000") = 開始日〜終了日の暦日カウント（全曜日勤務扱い）
    泊数    : 暦日数 - 1
    小計    : 宿泊料(泊数 × 単価) + 日当(暦日数 × 単価)

    消費税  : 出張旅費規程に基づく非課税扱いのため税額 0 で実装。将来課税要件が発生した場合は
              Compute-Tax フックを差し替える。

    入力CSV (UTF-8 BOM, ヘッダ行付き):
        Entity,Destination,Region,StartDate,EndDate,Transport,Purpose
        SYC,中国・上海市,海外,2025/11/21,2025/11/24,飛行機,JETRO高村様往訪
        LOC,広島市,甲地,2025/12/02,2025/12/03,電車等,広島平和記念公園クリニック

    出力 (Ready_for_Export):
        - <ProjectName>_<EntityName>_<yyyyMMdd>.csv  (集計データ)
        - receipts/ 配下に証憑PDFを (-ReceiptSource 指定時) コピー
        - 完了後 Pipeline ステータスを 4. Ready_for_Export に遷移

.PARAMETER InputCsv
    入力CSVファイルパス。

.PARAMETER ProjectName
    Pipeline / Action_Log で識別する案件名。

.PARAMETER ReceiptSource
    証憑PDFが格納されているディレクトリ。指定された場合 receipts/ に複製する。

.PARAMETER Root
    ClaudeSync ルート。既定 C:\ClaudeSync。

.PARAMETER Agent
    実行担当エージェント名。既定 'AIEijiCFO'。

.EXAMPLE
    .\Invoke-ExpenseCalculation.ps1 `
        -InputCsv 'C:\ClaudeSync\00_Inbox\三箇_2025Q4_trips.csv' `
        -ProjectName '三箇栄司_出張旅費_2025Q4' `
        -ReceiptSource 'C:\ClaudeSync\00_Inbox\receipts_2025Q4'

.NOTES
    Author : AIEijiSE  (logic 移植元: 出張旅費請求書 (三箇栄司SYC_LOC両方).xlsx)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$InputCsv,
    [Parameter(Mandatory)] [string]$ProjectName,
    [string]$ReceiptSource,
    [string]$Root  = 'C:\ClaudeSync',
    [string]$Agent = 'AIEijiCFO'
)

$ErrorActionPreference = 'Stop'

# 共通ログ関数読み込み
$logModule = Join-Path $PSScriptRoot 'Write-PipelineLog.ps1'
if (-not (Test-Path -LiteralPath $logModule)) {
    throw "Write-PipelineLog.ps1 not found at $logModule"
}
. $logModule

# === 規程テーブル =========================================================
$RateTable = @{
    'SYC' = @{
        Lodging = @{ '海外' = 23000; '甲地' = 23000; '乙地' = 23000 }
        Per_Diem = @{ '海外' = 80000; '甲地' = 40000; '乙地' = 32000 }
        EntityName = 'カープロード鼻専門クリニック'
        Position   = '事務長'
    }
    'LOC' = @{
        Lodging = @{ '海外' = 18000; '甲地' = 18000; '乙地' = 18000 }
        Per_Diem = @{ '海外' = 50000; '甲地' = 30000; '乙地' = 25000 }
        EntityName = '有限会社エルオーシー・テイカ'
        Position   = '代表取締役'
    }
}

$ValidRegions = @('海外', '甲地', '乙地')
$ValidEntities = @('SYC', 'LOC')

# === 計算関数 =============================================================
function Get-NetworkDays {
    <#
    .SYNOPSIS
        Excel の NETWORKDAYS.INTL(start, end, "0000000") 相当。全曜日を勤務日扱いとした暦日カウント。
    #>
    param([datetime]$Start, [datetime]$End)
    if ($End -lt $Start) { throw "EndDate ($End) is earlier than StartDate ($Start)." }
    return ([int](($End.Date - $Start.Date).TotalDays)) + 1
}

function Compute-LineItem {
    param(
        [string]$Entity,
        [string]$Region,
        [datetime]$Start,
        [datetime]$End
    )
    if ($Entity -notin $ValidEntities) {
        throw "Invalid entity '$Entity'. Must be one of: $($ValidEntities -join ', ')"
    }
    if ($Region -notin $ValidRegions) {
        throw "Invalid region '$Region'. Must be one of: $($ValidRegions -join ', ')"
    }

    $days   = Get-NetworkDays -Start $Start -End $End  # = O列
    $nights = $days - 1                                # = M列
    if ($nights -lt 0) { $nights = 0 }

    $lodgingRate = $RateTable[$Entity].Lodging[$Region]
    $perDiemRate = $RateTable[$Entity].Per_Diem[$Region]

    $lodgingSubtotal = $nights * $lodgingRate
    $perDiemSubtotal = $days   * $perDiemRate
    $lineTotal = $lodgingSubtotal + $perDiemSubtotal

    [pscustomobject]@{
        Days            = $days
        Nights          = $nights
        LodgingRate     = $lodgingRate
        PerDiemRate     = $perDiemRate
        LodgingSubtotal = $lodgingSubtotal
        PerDiemSubtotal = $perDiemSubtotal
        LineTotal       = $lineTotal
    }
}

function Compute-Tax {
    <#
    .SYNOPSIS
        消費税算出フック。出張旅費規程ベースのため既定 0。将来課税化する場合のみ実装差替え。
    #>
    param([decimal]$Amount)
    return [decimal]0
}

# === メイン処理 ===========================================================
$pipelineEntry = "$ProjectName ($Agent)"
Write-ActionLog -Agent $Agent -Message "計算開始: $ProjectName  (input=$InputCsv)"

if (-not (Test-Path -LiteralPath $InputCsv)) {
    throw "InputCsv not found: $InputCsv"
}

$rows = Import-Csv -LiteralPath $InputCsv -Encoding UTF8

# エンティティ別バケット
$buckets = @{
    'SYC' = New-Object System.Collections.Generic.List[object]
    'LOC' = New-Object System.Collections.Generic.List[object]
}

$rowNo = 1
foreach ($r in $rows) {
    $entity = ($r.Entity).Trim().ToUpper()
    $region = ($r.Region).Trim()
    try {
        $start = [datetime]::Parse($r.StartDate)
        $end   = [datetime]::Parse($r.EndDate)
    } catch {
        throw "Row $rowNo : date parse error ($($r.StartDate), $($r.EndDate))"
    }

    $calc = Compute-LineItem -Entity $entity -Region $region -Start $start -End $end

    $buckets[$entity].Add([pscustomobject]@{
        Row             = $rowNo
        Entity          = $entity
        Destination     = $r.Destination
        Region          = $region
        StartDate       = $start.ToString('yyyy-MM-dd')
        EndDate         = $end.ToString('yyyy-MM-dd')
        Transport       = $r.Transport
        Purpose         = $r.Purpose
        Days            = $calc.Days
        Nights          = $calc.Nights
        LodgingRate     = $calc.LodgingRate
        PerDiemRate     = $calc.PerDiemRate
        LodgingSubtotal = $calc.LodgingSubtotal
        PerDiemSubtotal = $calc.PerDiemSubtotal
        LineTotal       = $calc.LineTotal
        Tax             = (Compute-Tax -Amount $calc.LineTotal)
    })
    $rowNo++
}

# 出力先
$readyDir = Join-Path $Root '02_CFO\Ready_for_Export'
if (-not (Test-Path -LiteralPath $readyDir)) {
    throw "Ready_for_Export not found. Run Initialize-CFODirectory.ps1 first."
}
$receiptsDir = Join-Path $readyDir 'receipts'

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outputs = New-Object System.Collections.Generic.List[string]

foreach ($entity in $ValidEntities) {
    if ($buckets[$entity].Count -eq 0) { continue }

    $fileName = "{0}_{1}_{2}.csv" -f $ProjectName, $entity, $stamp
    $outPath  = Join-Path $readyDir $fileName

    $items = $buckets[$entity]
    $grandTotal   = ($items | Measure-Object -Property LineTotal -Sum).Sum
    $taxTotal     = ($items | Measure-Object -Property Tax       -Sum).Sum
    $lodgingTotal = ($items | Measure-Object -Property LodgingSubtotal -Sum).Sum
    $perDiemTotal = ($items | Measure-Object -Property PerDiemSubtotal -Sum).Sum

    # CSV (BOM 付き UTF-8)
    $items | Export-Csv -LiteralPath $outPath -Encoding UTF8 -NoTypeInformation

    # サマリ行を追記
    Add-Content -LiteralPath $outPath -Value '' -Encoding UTF8
    Add-Content -LiteralPath $outPath -Value "# SUMMARY,Entity=$entity,EntityName=$($RateTable[$entity].EntityName)" -Encoding UTF8
    Add-Content -LiteralPath $outPath -Value "# LodgingTotal,$lodgingTotal" -Encoding UTF8
    Add-Content -LiteralPath $outPath -Value "# PerDiemTotal,$perDiemTotal" -Encoding UTF8
    Add-Content -LiteralPath $outPath -Value "# Tax,$taxTotal" -Encoding UTF8
    Add-Content -LiteralPath $outPath -Value "# GrandTotal,$grandTotal" -Encoding UTF8

    $outputs.Add($outPath)
    Write-ActionLog -Agent $Agent -Message ("出力完了 [{0}] {1} 行 / 合計 {2:N0} 円 -> {3}" -f $entity, $items.Count, $grandTotal, $fileName)
}

# 証憑コピー
if ($PSBoundParameters.ContainsKey('ReceiptSource') -and $ReceiptSource) {
    if (Test-Path -LiteralPath $ReceiptSource) {
        if (-not (Test-Path -LiteralPath $receiptsDir)) {
            New-Item -ItemType Directory -Path $receiptsDir -Force | Out-Null
        }
        $copied = 0
        Get-ChildItem -LiteralPath $ReceiptSource -Filter '*.pdf' -File -Recurse | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $receiptsDir -Force
            $copied++
        }
        Write-ActionLog -Agent $Agent -Message "証憑PDF $copied 件を receipts/ に複製"
    } else {
        Write-ActionLog -Agent $Agent -Message "WARN: ReceiptSource not found: $ReceiptSource"
    }
}

# Pipeline ステータス遷移
try {
    Move-PipelineStatus `
        -ProjectName $ProjectName `
        -From '3. Calculated' `
        -To   '4. Ready_for_Export' `
        -Agent $Agent `
        -Message "出力ハーネス起動完了 (entries=$($outputs.Count))"
} catch {
    # 案件が Pipeline に未登録の場合は新規追加してから再遷移を試みる
    Write-ActionLog -Agent $Agent -Message "Pipeline 未登録のため Calculated に追加: $ProjectName"
    Add-PipelineEntry -ProjectName $ProjectName -Section '3. Calculated' -Agent $Agent
    Move-PipelineStatus `
        -ProjectName $ProjectName `
        -From '3. Calculated' `
        -To   '4. Ready_for_Export' `
        -Agent $Agent `
        -Message "出力ハーネス起動完了 (entries=$($outputs.Count))"
}

[pscustomobject]@{
    ProjectName = $ProjectName
    Outputs     = $outputs
    Receipts    = $receiptsDir
    Timestamp   = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
}
