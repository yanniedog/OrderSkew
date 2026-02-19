$ErrorActionPreference = "Stop"

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $toolRoot "frontend"
$sourceDir = Join-Path $toolRoot "source"
$orderskewRoot = Resolve-Path (Join-Path $toolRoot "..\..")
$targetDir = Join-Path $orderskewRoot "pages\chess_tree"

Write-Host "Running local chess tree checks..."
Push-Location $orderskewRoot
node test-chess-tree.js
Pop-Location

Write-Host "Verifying imported Rust source build..."
Push-Location $sourceDir
cargo build --quiet
cargo test --quiet
Pop-Location

Write-Host "Publishing frontend to $targetDir ..."
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
robocopy $frontendDir $targetDir /MIR | Out-Null
if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Host "Chess tree deployment sync complete."
