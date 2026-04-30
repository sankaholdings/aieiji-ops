<#
.SYNOPSIS
    Chatwork 全ルームから自分宛 [To:account_id] メンションを抽出する READ-ONLY ツール。

.DESCRIPTION
    GET /v2/me で自分の account_id を取得し、GET /v2/rooms で mention_num > 0 の
    ルームを抽出。各ルームに対し GET /v2/rooms/{id}/messages?force=0 で未読メッセージを
    取得し、本文中の [To:<self_account_id>] メンションタグを含むものだけを抽出して
    Markdown サマリを標準出力する。

    送信・既読化等の WRITE 操作は一切行わない。

.PARAMETER EnvFile
    CHATWORK_API_TOKEN を含む .env ファイルパス。既定は orchestrator/.env。

.PARAMETER BodySummaryLength
    本文要約の最大文字数（既定 120）。
#>
[CmdletBinding()]
param(
    [string]$EnvFile,
    [int]$BodySummaryLength = 120,
    # ?force=0 は未読のみを返すが、副作用として last_read_message_id を更新する
    # （= 既読化される）ことが観測されている。Issue 要件では READ-ONLY が
    # 必要なため、既定では force=1（最新100件・既読フラグに副作用なし）を使い、
    # 取得後に直近 LookbackHours 時間以内のメッセージへ絞り込む。
    [ValidateSet('0','1')] [string]$Force = '1',
    [int]$LookbackHours = 168
)

$ErrorActionPreference = 'Stop'
$ApiBase = 'https://api.chatwork.com/v2'

if (-not $EnvFile) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $EnvFile = Join-Path $scriptDir '..\..\orchestrator\.env'
}

function Read-EnvToken {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw ".env not found: $Path"
    }
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    foreach ($line in $content -split "`r?`n") {
        if ($line -match '^\s*CHATWORK_API_TOKEN\s*=\s*(.+?)\s*$') {
            return $Matches[1].Trim('"').Trim("'")
        }
    }
    throw "CHATWORK_API_TOKEN not found in $Path"
}

function Invoke-Chatwork {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [hashtable]$Headers
    )
    return Invoke-RestMethod -Uri "$ApiBase$Path" -Method Get -Headers $Headers -TimeoutSec 30
}

function Get-BodySummary {
    param([string]$Body, [int]$MaxLen)
    if (-not $Body) { return '' }
    $compact = ($Body -replace "`r?`n", ' / ').Trim()
    if ($compact.Length -le $MaxLen) { return $compact }
    return ($compact.Substring(0, $MaxLen) + '…')
}

$token   = Read-EnvToken -Path $EnvFile
$headers = @{ 'X-ChatWorkToken' = $token; 'Accept' = 'application/json' }

# 1. 自分の account_id を取得
$me = Invoke-Chatwork -Path '/me' -Headers $headers
$selfId = [int]$me.account_id
$selfName = $me.name

# 2. ルーム一覧から mention_num > 0 を抽出
$rooms = Invoke-Chatwork -Path '/rooms' -Headers $headers
$roomsWithMention = @($rooms | Where-Object { $_.mention_num -gt 0 } | Sort-Object -Property mention_num -Descending)

$mentionTag = "[To:$selfId]"
$results = New-Object System.Collections.Generic.List[object]
$apiErrors = New-Object System.Collections.Generic.List[string]
$cutoffUtc = (Get-Date).ToUniversalTime().AddHours(-$LookbackHours)

foreach ($room in $roomsWithMention) {
    try {
        $messages = Invoke-Chatwork -Path "/rooms/$($room.room_id)/messages?force=$Force" -Headers $headers
    } catch {
        $apiErrors.Add("room_id=$($room.room_id) ($($room.name)): $($_.Exception.Message)") | Out-Null
        continue
    }
    if (-not $messages) { continue }

    foreach ($msg in $messages) {
        if (-not $msg.body) { continue }
        if ($msg.body.IndexOf($mentionTag) -lt 0) { continue }
        $sentUtc = [DateTimeOffset]::FromUnixTimeSeconds([int64]$msg.send_time).UtcDateTime
        if ($sentUtc -lt $cutoffUtc) { continue }
        $results.Add([pscustomobject]@{
            RoomId      = $room.room_id
            RoomName    = $room.name
            MessageId   = $msg.message_id
            SendTimeUtc = $sentUtc
            SenderName  = $msg.account.name
            BodySummary = (Get-BodySummary -Body $msg.body -MaxLen $BodySummaryLength)
        }) | Out-Null
    }
}

# 3. Markdown 出力
$jstNow = [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), [System.TimeZoneInfo]::FindSystemTimeZoneById('Tokyo Standard Time'))
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("## Chatwork 自分宛メンションスキャン結果")
[void]$sb.AppendLine()
[void]$sb.AppendLine("- 取得時刻: $($jstNow.ToString('yyyy-MM-dd HH:mm:ss')) JST")
[void]$sb.AppendLine("- 対象アカウント: $selfName (account_id=$selfId)")
[void]$sb.AppendLine("- API: ``GET /v2/me`` + ``GET /v2/rooms`` + ``GET /v2/rooms/{id}/messages?force=$Force`` (READ-ONLY)")
[void]$sb.AppendLine("- 参加ルーム総数: $($rooms.Count) / 未読メンションありルーム (mention_num>0): $($roomsWithMention.Count)")
[void]$sb.AppendLine("- フィルタ条件: 本文に ``$mentionTag`` を含み、直近 $LookbackHours 時間以内のメッセージ")
[void]$sb.AppendLine()

if ($results.Count -eq 0) {
    [void]$sb.AppendLine('### 結果: 対応必要メッセージなし')
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("全 $($roomsWithMention.Count) ルームの未読を走査しましたが、社長宛 ``$mentionTag`` メンションは検出されませんでした。")
} else {
    [void]$sb.AppendLine("### 自分宛メンション $($results.Count) 件")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('| # | ルーム | 送信日時 (JST) | 送信者 | 本文要約 |')
    [void]$sb.AppendLine('|---:|---|---|---|---|')
    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Tokyo Standard Time')
    $i = 0
    foreach ($r in ($results | Sort-Object SendTimeUtc -Descending)) {
        $i++
        $jst = [System.TimeZoneInfo]::ConvertTimeFromUtc($r.SendTimeUtc, $tz)
        $body = ($r.BodySummary -replace '\|', '\|')
        [void]$sb.AppendLine("| $i | $($r.RoomName) | $($jst.ToString('yyyy-MM-dd HH:mm:ss')) | $($r.SenderName) | $body |")
    }
}

if ($apiErrors.Count -gt 0) {
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("### 取得エラー ($($apiErrors.Count) 件)")
    foreach ($e in $apiErrors) {
        [void]$sb.AppendLine("- $e")
    }
}

$sb.ToString()
