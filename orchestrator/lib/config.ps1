# =============================================================
# config.ps1 — Orchestrator global settings
# =============================================================

$script:RepoRoot      = 'C:\aieiji-ops'
$script:LogDir        = Join-Path $script:RepoRoot 'logs'
$script:ActionLogPath = Join-Path $script:LogDir 'Action_Log.md'
$script:PauseFilePath = Join-Path $script:RepoRoot 'PAUSE'
$script:EnvFilePath   = Join-Path $PSScriptRoot '..\.env' | Resolve-Path -ErrorAction SilentlyContinue

# Issue labels
$script:LabelAutoProcess  = 'auto-process'
$script:LabelNeedsApprove = 'needs-approval'
$script:LabelInProgress   = 'in-progress'
$script:LabelProcessed    = 'processed'
$script:LabelFailed       = 'failed'

# GitHub
$script:GitHubRepo = 'sankaholdings/aieiji-ops'

# Chatwork
$script:ChatworkApiBase = 'https://api.chatwork.com/v2'
$script:ChatworkRoomId  = '46076523'  # マイチャット

# Mutex
$script:MutexName = 'Global\AIEiji_AieijiOps_Mutex'

# Agent name for log
$script:AgentName = 'AIEijiSE@1106PC'

# Ensure log directory exists
if (-not (Test-Path -LiteralPath $script:LogDir)) {
    New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null
}
