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

# --- Phase 1: contacts, consent, inbox ---
Write-Host ""
Write-Host "Phase 1: contacts + inbox"

$p1jar = Join-Path $env:TEMP "appolo_p1_cookies.txt"
$p1resp = Join-Path $env:TEMP "appolo_p1_resp.json"
$p1body = Join-Path $env:TEMP "appolo_p1_body.json"

function Read-Json($path) {
    try {
        $raw = Get-Content -Raw $path -ErrorAction Stop
        if (-not $raw) { return $null }
        return ($raw | ConvertFrom-Json)
    } catch { return $null }
}

function Json-Post($url, $obj) {
    [IO.File]::WriteAllText($p1body, ($obj | ConvertTo-Json -Compress -Depth 6))
    $code = (curl.exe -s -o $p1resp -w "%{http_code}" -b $p1jar -c $p1jar -X POST -H "Content-Type: application/json" --data "@$p1body" $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (Read-Json $p1resp) }
}

function Json-Get($url) {
    $code = (curl.exe -s -o $p1resp -w "%{http_code}" -b $p1jar -c $p1jar $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (Read-Json $p1resp) }
}

function Twilio-Post($to, $from, $smsBody, $sid) {
    return (curl.exe -s -o $p1resp -w "%{http_code}" -X POST `
        --data-urlencode "To=$to" --data-urlencode "From=$from" `
        --data-urlencode "Body=$smsBody" --data-urlencode "MessageSid=$sid" `
        "$Base/api/webhooks/twilio/sms").Trim()
}

# Log into the demo org with a curl cookie jar.
[IO.File]::WriteAllText($p1body, (@{ email = "owner@appolo.test"; password = "appolo-demo-1234" } | ConvertTo-Json -Compress))
curl.exe -s -c $p1jar -H "Content-Type: application/json" --data "@$p1body" "$Base/api/auth/login" | Out-Null

$p1stamp = [guid]::NewGuid().ToString("N").Substring(0, 8)
$randDigits = -join (1..4 | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })

# 1. create a contact through the API
$createdContact = Json-Post "$Base/api/contacts" @{
    name     = "Smoke Contact $p1stamp"
    channels = @(@{ kind = "phone"; value = "+1555555$randDigits" })
    tags     = @("smoke")
}
T "contact created via API" ($createdContact.code -eq 201 -and $createdContact.json.contact.name -like "Smoke Contact*")
$contactId = $createdContact.json.contact.id

$newDetail = Json-Get "$Base/api/contacts/$contactId"
T "reread contact has no sms consent yet" ($newDetail.json.consent.latest.sms -ne "granted")

# 2. inbound SMS creates a contact + conversation (no consent on file)
$inboundFrom = "+15555550199"
$inboundBody = "Hi there, are you open today?"
$smsCode = Twilio-Post "+15555550100" $inboundFrom $inboundBody "SM_smoke_$p1stamp"
T "inbound SMS webhook accepted" ($smsCode -eq "200")

$convos = Json-Get "$Base/api/conversations"
$smsConvo = @($convos.json.conversations) | Where-Object { $_.lastMessageBody -eq $inboundBody } | Select-Object -First 1
T "inbound SMS created a conversation" ($null -ne $smsConvo)
$smsConvoId = $smsConvo.id
$inboundContactId = $smsConvo.contactId

# 3. sending before consent is refused
$blocked = Json-Post "$Base/api/conversations/$smsConvoId/messages" @{ body = "This should be blocked" }
T "send without consent is blocked (409)" ($blocked.code -eq 409)
T "block reason is NO_CONSENT" ($blocked.json.code -eq "NO_CONSENT")

# 4. record consent, then the reply is delivered
$grant = Json-Post "$Base/api/contacts/$inboundContactId/consent" @{ channel = "sms"; status = "granted"; source = "smoke" }
T "consent grant recorded" ($grant.code -eq 201 -and $grant.json.consent.status -eq "granted")

$sent = Json-Post "$Base/api/conversations/$smsConvoId/messages" @{ body = "Yes, we are open until 6pm!" }
T "reply delivered once consent exists" ($sent.code -eq 201 -and $sent.json.message.status -eq "delivered")

# 5. STOP revokes consent and closes the thread
$stopCode = Twilio-Post "+15555550100" $inboundFrom "STOP" "SM_smoke_stop_$p1stamp"
T "STOP webhook accepted" ($stopCode -eq "200")

$stoppedDetail = Json-Get "$Base/api/contacts/$inboundContactId"
T "STOP revoked sms consent" ($stoppedDetail.json.consent.latest.sms -eq "revoked")

$stoppedConvo = Json-Get "$Base/api/conversations/$smsConvoId"
T "STOP closed the conversation" ($stoppedConvo.json.conversation.status -eq "closed")

$blocked2 = Json-Post "$Base/api/conversations/$smsConvoId/messages" @{ body = "Should still be blocked" }
T "send after STOP is blocked (409)" ($blocked2.code -eq 409)

# 6. web chat creates a contact + conversation and polls back
$visitor = "smoke-visitor-$p1stamp"
$wcSend = Json-Post "$Base/api/webchat/demo-webchat/messages" @{ visitorId = $visitor; body = "Hello from the widget" }
T "webchat inbound accepted" ($wcSend.code -eq 201)
$wcContactId = $wcSend.json.contactId

$wcPoll = Json-Get "$Base/api/webchat/demo-webchat/messages?visitorId=$visitor"
$hasInbound = @($wcPoll.json.messages) | Where-Object { $_.body -eq "Hello from the widget" }
T "webchat message polls back" ($null -ne $hasInbound)

$wcConvos = Json-Get "$Base/api/conversations?channel=webchat"
T "webchat conversation appears in the list" (@($wcConvos.json.conversations).Count -ge 1)

# 7. pages and export render
$inboxHtml = Join-Path $env:TEMP "appolo_smoke_inbox.html"
$inboxStatus = (curl.exe -s -b $p1jar -o $inboxHtml -w "%{http_code}" "$Base/app/inbox").Trim()
$inboxContent = Get-Content -Raw $inboxHtml -ErrorAction SilentlyContinue
T "inbox page renders" ($inboxStatus -eq "200")
T "inbox shows the Inbox heading" ($inboxContent -match "Inbox")

$contactsHtml = Join-Path $env:TEMP "appolo_smoke_contacts.html"
$contactsStatus = (curl.exe -s -b $p1jar -o $contactsHtml -w "%{http_code}" "$Base/app/contacts").Trim()
T "contacts page renders" ($contactsStatus -eq "200")

$exportStatus = (curl.exe -s -b $p1jar -o $p1resp -w "%{http_code}" "$Base/api/contacts/export").Trim()
T "contacts CSV export works" ($exportStatus -eq "200")

Remove-Item $p1jar, $p1resp, $p1body, $inboxHtml, $contactsHtml -Force -ErrorAction SilentlyContinue

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
        $smokeIds = @($contactId, $inboundContactId, $wcContactId) |
            Where-Object { $_ -and $_ -match '^[0-9a-fA-F-]{36}$' } |
            Select-Object -Unique
        $contactDelete = ""
        if ($smokeIds.Count -gt 0) {
            $idList = ($smokeIds | ForEach-Object { "'$_'" }) -join ","
            $contactDelete = "delete from contacts where id in ($idList);"
        }

        $cleanupSql = @"
delete from orgs where slug like 'smoke-co-%';
delete from locations where name = 'Smoke Test Site'
  and org_id = (select id from orgs where slug = 'demo');
$contactDelete
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