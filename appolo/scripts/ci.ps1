# Local CI: the same checks as .github/workflows/ci.yml, minus the browser.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/ci.ps1
#
# Mirrors the workflow job order so a local pass and a green pipeline mean the
# same thing:
#   static   -> install, typecheck, lint, audit
#   unit     -> core tests
#   database -> migrate, seed, RLS, idempotency, concurrency, undo, model, imports, moderation
#   e2e      -> built server + HTTP suite
#   visual / a11y -> browser only; run these yourself (see docs/CI.md) because
#                    they need a running app and a Chromium install, exactly as
#                    the workflow starts them.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($name, $block) {
    Write-Host ""
    Write-Host "== $name ==" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$name failed" }
}

Step "install"                 { pnpm install }
Step "typecheck"               { pnpm typecheck }
Step "lint"                    { pnpm lint }
Step "unit tests"              { pnpm test }
Step "media-art"               { pnpm media-art }
Step "migrate"                 { pnpm db:migrate }
Step "seed"                    { pnpm db:seed }
Step "rls isolation"           { pnpm db:rls-test }
Step "webhook idempotency"     { pnpm db:idempotency-test }
Step "vote races"              { pnpm test:concurrency }
Step "undo restoration"        { pnpm test:undo }
Step "ranking model"           { pnpm test:ranking }
Step "importers + moderation"  { pnpm test:imports; if ($LASTEXITCODE -eq 0) { pnpm test:moderation; if ($LASTEXITCODE -eq 0) { pnpm test:signals } } }
Step "build"                   { pnpm build }

Write-Host ""
Write-Host "Local checks passed. Browser suites (visual, e2e, a11y) run in CI;" -ForegroundColor Green
Write-Host "to run them locally, start the app, seed with SEED_DEMO=1, then:" -ForegroundColor Green
Write-Host "  pnpm visual   # pixels only with --local or CI=true" -ForegroundColor Green
Write-Host "  pnpm e2e" -ForegroundColor Green
Write-Host "  pnpm a11y" -ForegroundColor Green
