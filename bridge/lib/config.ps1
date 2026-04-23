# =============================================================
# bridge/lib/config.ps1 - Bridge Script global settings
# =============================================================

$script:BridgeRoot    = 'C:\aieiji-ops\bridge'
$script:BridgeState   = Join-Path $script:BridgeRoot 'state'
$script:OpsRoot       = 'C:\aieiji-ops'
$script:OpsLogPath    = Join-Path $script:OpsRoot 'logs\Action_Log.md'

# G Drive SSoT paths (ejsan user context required)
$script:GDriveRoot    = 'G:\マイドライブ\さんか経営会議（経営分析）\00_System (システム設定)\Claude(SANKA)'
$script:GDriveActionLog = Join-Path $script:GDriveRoot '00_System\Action_Log.md'
$script:GDriveBridgeDir = Join-Path $script:GDriveRoot 'bridge'
$script:GDriveHeartbeat = Join-Path $script:GDriveBridgeDir 'heartbeat.json'
$script:GDrivePauseFile = Join-Path $script:GDriveBridgeDir 'PAUSE'
$script:GDriveDigestDir = Join-Path $script:GDriveBridgeDir 'digest'
$script:GDriveSessionLog = Join-Path $script:GDriveRoot 'session_log.md'
$script:GDriveStatusMd   = Join-Path $script:GDriveRoot 'STATUS.md'

# State files (local only)
$script:LastMirrorFile = Join-Path $script:BridgeState 'last_mirror.json'
$script:LastDigestFile = Join-Path $script:BridgeState 'last_digest.txt'

# Identity
$script:PcName   = '1106PC'
$script:HostName = $env:COMPUTERNAME

# Mutex
$script:BridgeMutexName = 'Global\AIEiji_Bridge_Mutex'

# Ensure state dir
if (-not (Test-Path -LiteralPath $script:BridgeState)) {
    New-Item -ItemType Directory -Path $script:BridgeState -Force | Out-Null
}
