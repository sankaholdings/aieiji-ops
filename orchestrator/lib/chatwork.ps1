# =============================================================
# chatwork.ps1 — Chatwork REST API notifier
# =============================================================

function Send-ChatworkMessage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Body,
        [string]$RoomId = $script:ChatworkRoomId
    )
    $token = $env:CHATWORK_API_TOKEN
    if (-not $token) {
        Write-ActionLog -Level WARN -Message "Chatwork通知スキップ: CHATWORK_API_TOKEN 未設定"
        return $false
    }
    $uri = "$script:ChatworkApiBase/rooms/$RoomId/messages"
    $headers = @{ 'X-ChatWorkToken' = $token }
    $form = @{ body = $Body; self_unread = '1' }
    try {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $form -TimeoutSec 30 | Out-Null
        return $true
    } catch {
        Write-ActionLog -Level ERROR -Message "Chatwork送信失敗: $($_.Exception.Message)"
        return $false
    }
}
