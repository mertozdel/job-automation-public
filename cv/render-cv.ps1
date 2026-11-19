# Re-renders cv/CV.pdf (source\CV.html), cv/CV_de.pdf (source\CV.de.html) and
# cv/Portfolio.pdf (source\Portfolio.html) with headless Edge. Edit the HTML, run this, and the
# workflows attach the new CV PDFs on their next run (the portfolio is not attached by any workflow).

$ErrorActionPreference = "Stop"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
# A separate profile: with the default one, a running Edge takes over the call and no PDF is written.
$profile = Join-Path $env:TEMP "cv-render-edge-profile"
$latin1 = [Text.Encoding]::GetEncoding(28591)   # works on Windows PowerShell 5.1 and 7

foreach ($cv in @(@("CV.html", "CV.pdf"), @("CV.de.html", "CV_de.pdf"),
                  @("Portfolio.html", "Portfolio.pdf"))) {
    $src = (Resolve-Path (Join-Path $PSScriptRoot "source\$($cv[0])")).Path
    $out = Join-Path $PSScriptRoot $cv[1]
    $before = if (Test-Path $out) { (Get-Item $out).LastWriteTimeUtc } else { [datetime]::MinValue }

    # --virtual-time-budget gives the Google Fonts time to load before printing.
    Start-Process -FilePath $edge -Wait -ArgumentList @(
        "--headless", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=8000",
        "--user-data-dir=`"$profile`"", "`"--print-to-pdf=$out`"", ([Uri]$src).AbsoluteUri)

    if (-not (Test-Path $out) -or (Get-Item $out).LastWriteTimeUtc -le $before) { throw "Edge did not write $out" }
    $pages = ([regex]::Matches([IO.File]::ReadAllText($out, $latin1), '/Type\s*/Page[^s]')).Count
    Write-Host "Wrote $out ($pages pages)" -ForegroundColor Green
}
