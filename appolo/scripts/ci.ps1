# Local CI: everything that must pass before a commit.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/ci.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($name, $block) {
    Write-Host ""
    Write-Host "== $name ==" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$name failed" }
}

Step "install"        { pnpm install }
Step "typecheck"      { pnpm typecheck }
Step "migrate"        { pnpm db:migrate }
Step "seed"           { pnpm db:seed }
Step "rls isolation"  { pnpm db:rls-test }
Step "build"          { pnpm build }

Write-Host ""
Write-Host "ALL CHECKS PASSED" -ForegroundColor Green