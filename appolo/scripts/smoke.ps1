# End-to-end smoke test against a running web server.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1 [-Base http://localhost:3000]

param([string]$Base = "http://localhost:3000")

$ErrorActionPreference = "Continue"
$script:pass = 0
$script:fail = 0

function T($name, $cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $name" -ForegroundColor Green }
    else { $script:fail++; Write-Host "FAIL  $name" -ForegroundColor Red }
}

Write-Host "waiting for $Base ..."
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    try {
        $h = Invoke-RestMethod "$Base/api/health" -TimeoutSec 4
        if ($h.ok) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
T "server is up and database is reachable" $ready
if (-not $ready) { exit 1 }

# --- anonymous: /app must redirect to /login ---
$redir = (curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" "$Base/app").Trim()
$redirected = ($redir -match "^3\d\d\s+\S*/login")
T "unauth /app redirects to /login" $redirected

# --- login with the seeded demo owner ---
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$body = @{ email = "owner@appolo.test"; password = "appolo-demo-1234" } | ConvertTo-Json
$login = Invoke-RestMethod "$Base/api/auth/login" -Method Post -Body $body -ContentType "application/json" -WebSession $session -TimeoutSec 30
T "demo login succeeds" ($login.ok -eq $true)

# --- identity + tenancy ---
$me = Invoke-RestMethod "$Base/api/me" -WebSession $session -TimeoutSec 20
T "me returns the seeded org" ($me.org.slug -eq "demo")
T "me returns owner role" ($me.membership.role -eq "owner")
T "owner has all capabilities" ($me.capabilities -contains "org:manage")

$locations = Invoke-RestMethod "$Base/api/locations" -WebSession $session -TimeoutSec 20
T "seeded location is visible" (@($locations.locations).Count -ge 1)
T "seeded location is Main Street" (@($locations.locations)[0].name -eq "Main Street")

# --- create a location ---
$newLoc = @{ name = "Smoke Test Site"; address = "1 Test Way"; timezone = "UTC" } | ConvertTo-Json
$created = Invoke-RestMethod "$Base/api/locations" -Method Post -Body $newLoc -ContentType "application/json" -WebSession $session -TimeoutSec 20
T "location created via API" ($created.location.name -eq "Smoke Test Site")

# --- dashboard renders with live data ---
# PowerShell 5.1 Invoke-WebRequest throws NullReferenceException against the
# Next.js dev server, so HTML pages are fetched with curl.exe.
$jar = Join-Path $env:TEMP "appolo_smoke_cookies.txt"
$bodyFile = Join-Path $env:TEMP "appolo_smoke_login.json"
$dashHtml = Join-Path $env:TEMP "appolo_smoke_dashboard.html"

$dashBody = @{ email = "owner@appolo.test"; password = "appolo-demo-1234" } | ConvertTo-Json -Compress
[IO.File]::WriteAllText($bodyFile, $dashBody)
curl.exe -s -c $jar -H "Content-Type: application/json" --data "@$bodyFile" "$Base/api/auth/login" | Out-Null

$dashStatus = (curl.exe -s -b $jar -o $dashHtml -w "%{http_code}" "$Base/app").Trim()
$dashContent = Get-Content -Raw $dashHtml -ErrorAction SilentlyContinue
T "dashboard renders" ($dashStatus -eq "200")
T "dashboard shows Overview" ($dashContent -match "Overview")
T "dashboard shows the org name" ($dashContent -match "Demo Business")
Remove-Item $jar, $bodyFile, $dashHtml -Force -ErrorAction SilentlyContinue

# --- new org signup is isolated ---
$fresh = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$stamp = [guid]::NewGuid().ToString("N").Substring(0, 8)
$signup = @{
    orgName  = "Smoke Co $stamp"
    name     = "Smoke Tester"
    email    = "smoke-$stamp@appolo.test"
    password = "smoke-test-1234"
} | ConvertTo-Json
$signupRes = Invoke-RestMethod "$Base/api/auth/signup" -Method Post -Body $signup -ContentType "application/json" -WebSession $fresh -TimeoutSec 30
T "signup creates a workspace" ($signupRes.ok -eq $true)

$freshMe = Invoke-RestMethod "$Base/api/me" -WebSession $fresh -TimeoutSec 20
T "new session sees the new org" ($freshMe.org.slug -ne "demo")

$freshLocations = Invoke-RestMethod "$Base/api/locations" -WebSession $fresh -TimeoutSec 20
T "new org sees exactly one location" (@($freshLocations.locations).Count -eq 1)
$leaked = @($freshLocations.locations) | Where-Object { $_.name -eq "Main Street" }
T "new org cannot see demo data" ($null -eq $leaked)

$dupe = @{
    orgName  = "Smoke Co Dup"
    name     = "Smoke Tester"
    email    = "smoke-$stamp@appolo.test"
    password = "smoke-test-1234"
} | ConvertTo-Json
$dupeRejected = $false
try {
    Invoke-RestMethod "$Base/api/auth/signup" -Method Post -Body $dupe -ContentType "application/json" -TimeoutSec 20 | Out-Null
} catch { $dupeRejected = $true }
T "duplicate email is rejected" $dupeRejected

# --- logout clears the session ---
Invoke-RestMethod "$Base/api/auth/logout" -Method Post -WebSession $session -TimeoutSec 20 | Out-Null
$afterLogout = $false
try {
    Invoke-RestMethod "$Base/api/me" -WebSession $session -TimeoutSec 20 | Out-Null
} catch { $afterLogout = $true }
T "logout invalidates the session" $afterLogout

# --- cleanup: remove rows this test created (best effort) ---
# Keeps reruns from accumulating demo locations and throwaway orgs.
try {
    $pgBin = $env:PG_BIN
    if (-not $pgBin) {
        $installs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending
        foreach ($i in $installs) {
            $candidate = Join-Path $i.FullName "bin"
            if (Test-Path (Join-Path $candidate "psql.exe")) { $pgBin = $candidate; break }
        }
    }
    $psqlExe = if ($pgBin) { Join-Path $pgBin "psql.exe" } else { $null }

    $envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"
    $dbUrl = $null
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^\s*MIGRATE_DATABASE_URL\s*=' } | Select-Object -First 1
        if ($line) { $dbUrl = ($line -split '=', 2)[1].Trim() }
    }
    if (-not $dbUrl) { $dbUrl = "postgresql://appolo@127.0.0.1:55432/appolo" }

    if ($psqlExe -and (Test-Path $psqlExe)) {
        $cleanupSql = @"
delete from orgs where slug like 'smoke-co-%';
delete from locations where name = 'Smoke Test Site'
  and org_id = (select id from orgs where slug = 'demo');
"@
        $cleanupSql | & $psqlExe -d $dbUrl -v ON_ERROR_STOP=1 -f - | Out-Null
        Write-Host "cleanup: removed smoke test rows"
    } else {
        Write-Host "cleanup skipped (psql not found)"
    }
} catch {
    Write-Host "cleanup skipped: $($_.Exception.Message)"
}

Write-Host "---"
Write-Host "RESULT: pass=$script:pass fail=$script:fail"
exit ($(if ($script:fail -eq 0) { 0 } else { 1 }))