$ErrorActionPreference = 'Stop'
Start-Process powershell -ArgumentList '-NoExit','-Command','Set-Location "'+(Join-Path $PSScriptRoot 'backend')+'"; .\run.ps1'
Start-Process powershell -ArgumentList '-NoExit','-Command','Set-Location "'+(Join-Path $PSScriptRoot 'frontend')+'"; npm run dev'
