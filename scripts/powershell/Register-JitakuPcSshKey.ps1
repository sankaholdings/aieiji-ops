#Requires -Version 5.1
<#
.SYNOPSIS
Registers the jitaku-pc (eiji-fmv202504) ed25519 public key into Windows OpenSSH
authorized_keys on 1106PC so Tailscale-based passwordless SSH works.

.NOTES
GitHub Issue #7. Selects administrators_authorized_keys when the target account
is an Administrator, otherwise falls back to per-user ~/.ssh/authorized_keys, as
required by Windows OpenSSH Server.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$pubkey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJSdK10bOYwaJj0BPqwImGb/Tp3wh1s8Pwxt2mV08b8X jitaku-pc'

$isAdmin = (Get-LocalGroupMember -Group Administrators -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*\ejsan' }) -ne $null
Write-Host "ejsan is admin: $isAdmin"

if ($isAdmin) {
    $authFile = 'C:\ProgramData\ssh\administrators_authorized_keys'
    if (-not (Test-Path $authFile)) {
        New-Item -ItemType File -Path $authFile -Force | Out-Null
    }
    $existing = Get-Content $authFile -ErrorAction SilentlyContinue
    if ($existing -notcontains $pubkey) {
        Add-Content -Path $authFile -Value $pubkey -Encoding ASCII
        Write-Host "Key appended to $authFile"
    } else {
        Write-Host "Key already present (skipped)"
    }
    icacls $authFile /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
} else {
    $sshDir  = 'C:\Users\ejsan\.ssh'
    $authFile = Join-Path $sshDir 'authorized_keys'
    if (-not (Test-Path $sshDir))  { New-Item -ItemType Directory -Path $sshDir -Force | Out-Null }
    if (-not (Test-Path $authFile)) { New-Item -ItemType File -Path $authFile -Force | Out-Null }
    $existing = Get-Content $authFile -ErrorAction SilentlyContinue
    if ($existing -notcontains $pubkey) {
        Add-Content -Path $authFile -Value $pubkey -Encoding ASCII
        Write-Host "Key appended to $authFile"
    } else {
        Write-Host "Key already present (skipped)"
    }
    icacls $authFile /inheritance:r /grant:r "ejsan:F" /grant:r "SYSTEM:F" | Out-Null
}

Restart-Service sshd
Get-Service sshd | Format-Table Name, Status

$final = Get-Content $authFile -ErrorAction SilentlyContinue
if ($final -contains $pubkey) {
    Write-Host "VERIFY: key present in $authFile"
} else {
    throw "VERIFY FAILED: key not found in $authFile"
}
