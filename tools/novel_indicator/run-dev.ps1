$ErrorActionPreference = 'Stop'

$apiDir = Join-Path $PSScriptRoot 'cloudflare_api'
$frontendDir = Join-Path $PSScriptRoot 'frontend'

Start-Process powershell -ArgumentList '-NoExit','-Command',('Set-Location "' + $apiDir + '"; if (-not (Test-Path node_modules)) { npm ci }; npm run dev')
Start-Process powershell -ArgumentList '-NoExit','-Command',('Set-Location "' + $frontendDir + '"; if (-not (Test-Path node_modules)) { npm ci }; npm run dev')
