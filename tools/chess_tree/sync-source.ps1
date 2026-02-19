$ErrorActionPreference = "Stop"

$sourceRoot = "C:\code\chess-move-tree"
$targetRoot = Join-Path $PSScriptRoot "source"

if (-not (Test-Path $sourceRoot)) {
    throw "Source path not found: $sourceRoot"
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

Write-Host "Syncing chess source from $sourceRoot to $targetRoot ..."
robocopy $sourceRoot $targetRoot /E /XD target /XF *.db *.db-shm *.db-wal rustup-init.exe | Out-Null
if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Host "Source sync complete."
