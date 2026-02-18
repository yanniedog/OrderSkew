$ErrorActionPreference = "Stop"

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $toolRoot "backend"
$frontendDir = Join-Path $toolRoot "frontend"
$orderskewRoot = Resolve-Path (Join-Path $toolRoot "..\..")
$targetDir = Join-Path $orderskewRoot "pages\novel_indicator"

Write-Host "Running backend tests..."
Push-Location $backendDir
python -m pytest tests -q
Pop-Location

Write-Host "Building frontend..."
Push-Location $frontendDir
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    npm ci
}
npm run build
Pop-Location

Write-Host "Publishing static bundle to $targetDir..."
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
Copy-Item -Path (Join-Path $frontendDir "dist\*") -Destination $targetDir -Recurse -Force

Write-Host "Done."
