# =============================================================
# claude.ps1 — Claude Code headless invocation
# =============================================================

function Invoke-ClaudeCode {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Prompt,
        [string]$WorkingDirectory = $script:RepoRoot,
        [int]$TimeoutSec = 1800  # 30分
    )

    $guid = [Guid]::NewGuid().ToString('N')
    $stdoutFile = Join-Path $env:TEMP "aieiji_claude_out_$guid.txt"
    $stderrFile = Join-Path $env:TEMP "aieiji_claude_err_$guid.txt"

    try {
        # Escape prompt for command-line (double quotes around, escape embedded quotes)
        $escapedPrompt = '"' + ($Prompt -replace '"', '\"') + '"'

        $argString = '-p ' + $escapedPrompt + ' --output-format json --allowedTools "Read,Write,Edit,Glob,Grep,Bash" --add-dir "' + $WorkingDirectory + '"'

        $proc = Start-Process -FilePath 'claude' `
            -ArgumentList $argString `
            -WorkingDirectory $WorkingDirectory `
            -NoNewWindow `
            -PassThru `
            -RedirectStandardOutput $stdoutFile `
            -RedirectStandardError  $stderrFile

        if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
            try { $proc.Kill() } catch {}
            return @{ success = $false; message = "Claude Code呼び出しタイムアウト ($TimeoutSec秒)" }
        }

        $exitCode = $proc.ExitCode
        $stdout = if (Test-Path -LiteralPath $stdoutFile) { Get-Content -LiteralPath $stdoutFile -Raw -Encoding UTF8 } else { '' }
        $stderr = if (Test-Path -LiteralPath $stderrFile) { Get-Content -LiteralPath $stderrFile -Raw -Encoding UTF8 } else { '' }

        if ($exitCode -ne 0 -and $stderr) {
            $errSnippet = $stderr.Substring(0, [Math]::Min(200, $stderr.Length))
            Write-ActionLog -Level WARN -Message "claude exit=$exitCode, stderr=$errSnippet"
        }

        if ([string]::IsNullOrWhiteSpace($stdout)) {
            return @{ success = $false; message = "Claude Codeから出力なし (exit=$exitCode)" }
        }

        $result = $stdout | ConvertFrom-Json

        $costStr = if ($result.total_cost_usd) { '{0:F4}' -f $result.total_cost_usd } else { '0' }
        Write-ActionLog -Message "Claude実行: session=$($result.session_id), cost=`$$costStr, duration=$($result.duration_ms)ms, turns=$($result.num_turns)"

        # --- 成否判定 ---
        # (1) Claude Codeが is_error=true を返した場合は失敗
        # (2) is_error=false でも、本文末尾に 'RESULT: FAILED' が含まれていれば失敗扱い
        #     （Claude Code はタスク失敗時もエラー打ち切りせず、本文で報告するケースが多いため）
        # (3) 'RESULT: SUCCESS' / 'RESULT: FAILED' のいずれのマーカーも見当たらない場合は
        #     WARNログを残し、従来どおり is_error のみで判定する
        $isError = [bool]$result.is_error
        $message = [string]$result.result
        $resultMarker = $null
        if ($message -match '(?im)^\s*RESULT:\s*FAILED\b.*$') {
            $resultMarker = 'FAILED'
        } elseif ($message -match '(?im)^\s*RESULT:\s*SUCCESS\b.*$') {
            $resultMarker = 'SUCCESS'
        }

        if ($resultMarker -eq $null) {
            Write-ActionLog -Level WARN -Message "Claude応答に RESULT: マーカーなし (session=$($result.session_id)) — is_error のみで判定"
        } elseif ($resultMarker -eq 'FAILED' -and -not $isError) {
            Write-ActionLog -Level WARN -Message "Claude応答に RESULT: FAILED を検出 — 失敗扱いに振替 (session=$($result.session_id))"
        }

        $success = (-not $isError) -and ($resultMarker -ne 'FAILED')

        return @{
            success     = $success
            message     = $message
            cost_usd    = $result.total_cost_usd
            duration_ms = $result.duration_ms
            session_id  = $result.session_id
            num_turns   = $result.num_turns
        }

    } catch {
        Write-ActionLog -Level ERROR -Message "Claude Code呼び出し例外: $($_.Exception.Message)"
        return @{ success = $false; message = "例外: $($_.Exception.Message)" }
    } finally {
        Remove-Item -LiteralPath $stdoutFile -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stderrFile -Force -ErrorAction SilentlyContinue
    }
}
