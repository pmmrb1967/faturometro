# Weekly check of the COM.escolha links, run by Windows Task Scheduler on the
# maintainer's PC (ANACOM blocks GitHub's runners). Registered by
# scripts/comescolha-schedule.ps1; see docs/anacom-comescolha.md.
#
# Works in its own clone under %LOCALAPPDATA%, never in the development folder.
# - Check passes: commit src/data/comescolha.json (date of the check, and any
#   renamed parameters) and push to main; CI tests and redeploys the app.
# - A filter is ignored or a form changed (exit 2): open or comment on an issue,
#   so GitHub notifies the maintainer by email.
# - Anything else (no network, ANACOM down): only the log; the app reminds the
#   administrator after 14 days without a passing check.
#
# -DryRun: everything except the push and the issue (to try it out).

param([switch]$DryRun)

$ErrorActionPreference = 'Continue'
# Native output (the report, in Portuguese) is UTF-8.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Join-Path $env:LOCALAPPDATA 'faturometro-comescolha'
$repo = Join-Path $root 'repo'
$log = Join-Path $root 'check.log'
$remote = 'https://github.com/pmmrb1967/faturometro.git'
$issueTitle = 'Ligações ao COM.escolha deixaram de filtrar'

New-Item -ItemType Directory -Force $root | Out-Null

function Write-Log([string]$message) {
  "$(Get-Date -Format 's') $message" | Out-File -Append -Encoding utf8 $log
}

# Runs a native command and stops on a non-zero exit code.
function Invoke-Step([string]$what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

try {
  if (-not (Test-Path (Join-Path $repo '.git'))) {
    Invoke-Step 'git clone' { git clone --quiet $remote $repo }
  }
  Set-Location $repo
  Invoke-Step 'git fetch' { git fetch --quiet origin main }
  Invoke-Step 'git checkout' { git checkout --quiet -B main origin/main }
  Invoke-Step 'git reset' { git reset --quiet --hard origin/main }
  Invoke-Step 'pnpm install' { pnpm install --frozen-lockfile --silent }

  $report = pnpm --silent comescolha:check | Out-String
  $code = $LASTEXITCODE
  Write-Log "check exit $code`n$report"

  if ($code -eq 0) {
    git diff --quiet -- src/data/comescolha.json
    if ($LASTEXITCODE -ne 0) {
      Invoke-Step 'git add' { git add src/data/comescolha.json }
      Invoke-Step 'git commit' { git commit --quiet -m 'chore(data): COM.escolha links checked' }
      if ($DryRun) {
        Write-Log 'dry run: would push'
        Write-Output (git show --stat HEAD | Out-String)
      } else {
        Invoke-Step 'git push' { git push --quiet origin main }
        Write-Log 'pushed'
      }
    }
  } elseif ($code -eq 2) {
    if ($DryRun) {
      Write-Log 'dry run: would open an issue'
      Write-Output $report
      exit 2
    }
    $body = Join-Path $root 'report.md'
    $report | Out-File -Encoding utf8 $body
    $number = gh issue list --repo pmmrb1967/faturometro --state open `
      --search "`"$issueTitle`" in:title" --json number -q '.[0].number'
    if ($number) {
      Invoke-Step 'gh issue comment' { gh issue comment $number --repo pmmrb1967/faturometro --body-file $body }
    } else {
      Invoke-Step 'gh issue create' { gh issue create --repo pmmrb1967/faturometro --title $issueTitle --body-file $body }
    }
    Write-Log 'issue opened or updated'
  } else {
    exit $code
  }
} catch {
  Write-Log "error: $_"
  exit 1
}
