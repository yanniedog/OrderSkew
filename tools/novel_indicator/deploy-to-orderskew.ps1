$ErrorActionPreference = 'Stop'

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $toolRoot 'frontend'
$apiDir = Join-Path $toolRoot 'cloudflare_api'
$orderskewRoot = Resolve-Path (Join-Path $toolRoot '..\..')
$targetDir = Join-Path $orderskewRoot 'pages\novel_indicator'

Write-Host 'Typechecking and testing Cloudflare API...'
Push-Location $apiDir
if (-not (Test-Path (Join-Path $apiDir 'node_modules'))) {
    npm ci
}
npm run typecheck
npm run test
Pop-Location

Write-Host 'Building frontend bundle...'
Push-Location $frontendDir
if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
    npm ci
}
npm run build
Pop-Location

Write-Host "Publishing static bundle to $targetDir ..."
if (Test-Path $targetDir) {
    Get-ChildItem -Path $targetDir -Force | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
Copy-Item -Path (Join-Path $frontendDir 'dist\*') -Destination $targetDir -Recurse -Force

Write-Host 'Done.'
