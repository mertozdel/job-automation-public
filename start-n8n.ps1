# Starts n8n with the settings this project needs.
#
# Two things it sets up:
#   1. loads .env (OpenRouter key etc.) into the process environment
#   2. N8N_RESTRICT_FILE_ACCESS_TO  -- without this the Read CV node fails with
#      "Access to the file is not allowed". n8n defaults to allowing ~/.n8n-files ONLY,
#      so the cv/ folder has to be named explicitly.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$cvDir = Join-Path $root "cv"

# ---------------------------------------------------------------- .env (optional)
$envFile = Join-Path $root ".env"
$loaded = @()
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $i = $line.IndexOf("=")
        if ($i -lt 1) { return }
        $name = $line.Substring(0, $i).Trim()
        $value = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
        if ($value -eq "" -or $value -like "sk-or-v1-xxxx*") { return }
        Set-Item -Path "Env:$name" -Value $value
        $loaded += $name
    }
    if ($loaded.Count -gt 0) {
        Write-Host "Loaded from .env: $($loaded -join ', ')" -ForegroundColor Green
    } else {
        Write-Host ".env found but all values are still placeholders." -ForegroundColor Yellow
    }
} else {
    Write-Host "No .env (fine - the key can live in the n8n credential instead)." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- file access
if (-not (Test-Path $cvDir)) {
    Write-Host "cv folder not found at $cvDir" -ForegroundColor Red
    exit 1
}
$pdfs = @(Get-ChildItem -Path $cvDir -Filter *.pdf -ErrorAction SilentlyContinue)
if ($pdfs.Count -eq 0) {
    Write-Host "No PDF in $cvDir - Read CV will fail." -ForegroundColor Yellow
} else {
    Write-Host "CV found: $($pdfs[0].Name) ($([math]::Round($pdfs[0].Length/1KB)) KB)" -ForegroundColor Green
}

# exports/ is where Write Export saves the apply-yourself spreadsheet (Config.exportDir).
$exportDir = Join-Path $root "exports"
if (-not (Test-Path $exportDir)) { New-Item -ItemType Directory -Path $exportDir | Out-Null }

# Allow n8n's own default dir too, so nothing else breaks. Semicolon-separated.
$allowed = "$cvDir;$exportDir;$env:USERPROFILE\.n8n-files"
$env:N8N_RESTRICT_FILE_ACCESS_TO = $allowed
Write-Host "File access allowed for: $allowed" -ForegroundColor Green

Write-Host ""
Write-Host "Starting n8n on http://localhost:5678 ..." -ForegroundColor Cyan
npx n8n
