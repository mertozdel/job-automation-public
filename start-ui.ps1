# Starts the job list UI at http://localhost:5690 and opens it in the browser.
# It reads and writes the same `jobs` Postgres database as the n8n workflow (RUNBOOK step 1).
# Ctrl+C stops it. Running it again while it is up just opens the browser.

$ErrorActionPreference = "Stop"
$ui = Join-Path $PSScriptRoot "ui"

if (-not (Test-Path (Join-Path $ui "node_modules\pg"))) {
    Write-Host "Installing UI dependencies (pg) ..." -ForegroundColor Cyan
    npm install --prefix $ui --no-audit --no-fund
}

node (Join-Path $ui "server.js") --open
