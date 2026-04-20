# =============================================================
# log.ps1 — Action_Log.md writer with Mutex-based exclusion
# =============================================================

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
            throw "Mutex acquisition timeout ($TimeoutSec sec)."
        }
        & $ScriptBlock
    }
    finally {
        if ($acquired) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Write-ActionLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Message,
        [string]$Agent = $script:AgentName,
        [ValidateSet('INFO','WARN','ERROR')][string]$Level = 'INFO'
    )
    Invoke-WithMutex -ScriptBlock {
        if (-not (Test-Path -LiteralPath $script:ActionLogPath)) {
            New-Item -ItemType File -Path $script:ActionLogPath -Force | Out-Null
            "# Action_Log (aieiji-ops orchestrator)`r`n" | Add-Content -LiteralPath $script:ActionLogPath -Encoding UTF8
        }
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $line = "$ts [$Agent] [$Level] $Message"
        Add-Content -LiteralPath $script:ActionLogPath -Value $line -Encoding UTF8
    }
    Write-Host "[$Level] $Message"
}
