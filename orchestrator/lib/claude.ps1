# =============================================================
# claude.ps1 — Claude Code headless invocation (MVP stub)
# =============================================================

function Invoke-ClaudeCode {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Prompt,
        [string]$WorkingDirectory = $script:RepoRoot
    )

    # MVPスタブ: 実際にClaudeは呼び出さず、受信確認コメントを返すのみ
    # 本実装時は以下を有効化:
    #   $result = claude -p $Prompt --cwd $WorkingDirectory --output-format json
    #   return $result

    Write-ActionLog -Message "[STUB] Claude Code呼び出し（未実装）: prompt=$($Prompt.Substring(0, [Math]::Min(80, $Prompt.Length)))..."
    return @{
        success = $true
        stub    = $true
        message = "MVPスタブ応答: 処理スクリプトは未実装です。orchestrator/lib/claude.ps1 を編集して `claude -p` を有効化してください。"
    }
}
