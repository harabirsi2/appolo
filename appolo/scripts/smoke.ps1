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

function Json-Patch($url, $obj) {
    [IO.File]::WriteAllText($p1body, ($obj | ConvertTo-Json -Compress -Depth 6))
    $code = (curl.exe -s -o $p1resp -w "%{http_code}" -b $p1jar -c $p1jar -X PATCH -H "Content-Type: application/json" --data "@$p1body" $url).Trim()
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

# --- Phase 2: review requests, landing, feedback, sync ---
Write-Host ""
Write-Host "Phase 2: reviews"

$p2jar = Join-Path $env:TEMP "appolo_p2_cookies.txt"
$p2resp = Join-Path $env:TEMP "appolo_p2_resp.json"
$p2body = Join-Path $env:TEMP "appolo_p2_body.json"

function P2-ReadJson($path) {
    try {
        $raw = Get-Content -Raw $path -ErrorAction Stop
        if (-not $raw) { return $null }
        return ($raw | ConvertFrom-Json)
    } catch { return $null }
}

function P2-Post($url, $obj) {
    [IO.File]::WriteAllText($p2body, ($obj | ConvertTo-Json -Compress -Depth 6))
    $code = (curl.exe -s -o $p2resp -w "%{http_code}" -b $p2jar -c $p2jar -X POST -H "Content-Type: application/json" --data "@$p2body" $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (P2-ReadJson $p2resp) }
}

function P2-Get($url) {
    $code = (curl.exe -s -o $p2resp -w "%{http_code}" -b $p2jar -c $p2jar $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (P2-ReadJson $p2resp) }
}

function P2-Patch($url, $obj) {
    [IO.File]::WriteAllText($p2body, ($obj | ConvertTo-Json -Compress -Depth 6))
    $code = (curl.exe -s -o $p2resp -w "%{http_code}" -b $p2jar -c $p2jar -X PATCH -H "Content-Type: application/json" --data "@$p2body" $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (P2-ReadJson $p2resp) }
}

[IO.File]::WriteAllText($p2body, (@{ email = "owner@appolo.test"; password = "appolo-demo-1234" } | ConvertTo-Json -Compress))
curl.exe -s -c $p2jar -H "Content-Type: application/json" --data "@$p2body" "$Base/api/auth/login" | Out-Null

# 1. settings are readable and writable
$settingsGet = P2-Get "$Base/api/reviews/settings"
T "review settings readable" ($settingsGet.code -eq 200 -and $null -ne $settingsGet.json.settings.quietHours)

# 2. quiet hours block sends. Use a UTC window straddling "now".
$nowUtc = (Get-Date).ToUniversalTime()
$quietStart = $nowUtc.AddHours(-1).ToString("HH:mm")
$quietEnd = $nowUtc.AddHours(1).ToString("HH:mm")
$quietOn = P2-Patch "$Base/api/reviews/settings" @{
    timezone   = "UTC"
    quietHours = @{ enabled = $true; start = $quietStart; end = $quietEnd }
}
T "quiet hours enabled for test" ($quietOn.code -eq 200 -and $quietOn.json.settings.quietHours.enabled -eq $true)

$p2stamp = [guid]::NewGuid().ToString("N").Substring(0, 8)
$p2digits = -join (1..4 | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })
$reviewContact = P2-Post "$Base/api/contacts" @{
    name     = "Review Contact $p2stamp"
    channels = @(@{ kind = "phone"; value = "+1555557$p2digits" })
}
$reviewContactId = $reviewContact.json.contact.id
T "review contact created" ($reviewContact.code -eq 201)

$reviewGrant = P2-Post "$Base/api/contacts/$reviewContactId/consent" @{ channel = "sms"; status = "granted"; source = "smoke" }
T "review contact consent granted" ($reviewGrant.code -eq 201)

$template = P2-Post "$Base/api/review-templates" @{
    name    = "Smoke Review $p2stamp"
    channel = "sms"
    body    = "Hi {{first_name}}, thanks for visiting {{business_name}}! Review us: {{review_link}}"
}
T "review template created" ($template.code -eq 201 -and $template.json.template.name -like "Smoke Review*")
$templateId = $template.json.template.id

# Quiet hours are evaluated in the location's timezone. Use the UTC
# "Smoke Test Site" location so the UTC window computed above is deterministic.
$smokeLocationId = $created.location.id

$blockedReview = P2-Post "$Base/api/review-requests" @{
    contactId    = $reviewContactId
    channel      = "sms"
    templateId   = $templateId
    platformKind = "google"
    locationId   = $smokeLocationId
}
T "review request blocked during quiet hours (409)" ($blockedReview.code -eq 409 -and $blockedReview.json.code -eq "QUIET_HOURS")

# 3. turn quiet hours off, then send for real.
$quietOff = P2-Patch "$Base/api/reviews/settings" @{ quietHours = @{ enabled = $false; start = "21:00"; end = "08:00" } }
T "quiet hours disabled" ($quietOff.code -eq 200 -and $quietOff.json.settings.quietHours.enabled -eq $false)

$sentReview = P2-Post "$Base/api/review-requests" @{
    contactId    = $reviewContactId
    channel      = "sms"
    templateId   = $templateId
    platformKind = "google"
    locationId   = $smokeLocationId
}
T "review request sent" ($sentReview.code -eq 201 -and $sentReview.json.status -eq "sent")
T "review request returns a landing link" ($sentReview.json.reviewUrl -match "/r/")
$reviewToken = ($sentReview.json.reviewUrl -split "/r/")[-1]

# 4. public token resolves without a session
$resolve = P2-Get "$Base/api/public/reviews/$reviewToken"
T "public review token resolves" ($resolve.code -eq 200 -and $resolve.json.businessName -eq "Demo Business")
T "landing exposes a public platform link" (@($resolve.json.platforms | Where-Object { $_.url }).Count -ge 1)

$landingHtml = Join-Path $env:TEMP "appolo_smoke_landing.html"
$landingStatus = (curl.exe -s -o $landingHtml -w "%{http_code}" "$Base/r/$reviewToken").Trim()
$landingContent = Get-Content -Raw $landingHtml -ErrorAction SilentlyContinue
T "public landing page renders" ($landingStatus -eq "200" -and $landingContent -match "How was your visit")
T "public review button is shown" ($landingContent -match "Review us on")

$demoResolve = P2-Get "$Base/api/public/reviews/demo-review-token-0001"
T "seeded demo review link resolves" ($demoResolve.code -eq 200)

# 5. private feedback is accepted and never blocks the public link
$feedbackRes = P2-Post "$Base/api/public/reviews/feedback" @{
    token  = $reviewToken
    rating = 2
    body   = "Smoke test private feedback"
    name   = "Smoke Tester"
}
T "private feedback accepted" ($feedbackRes.code -eq 200 -and $feedbackRes.json.ok -eq $true)
$resolveAfter = P2-Get "$Base/api/public/reviews/$reviewToken"
T "landing marks feedback received" ($resolveAfter.json.alreadyResponded -eq $true)

# 6. landing-page branding appears on the public link
$branding = P2-Patch "$Base/api/reviews/branding" @{
    accentColor  = "#0ea5e9"
    tagline      = "Smoke test tagline"
    supportEmail = "help@appolo.test"
}
T "landing branding saved" ($branding.code -eq 200 -and $branding.json.branding.accentColor -eq "#0ea5e9")
$brandedResolve = P2-Get "$Base/api/public/reviews/$reviewToken"
T "landing returns branding" ($brandedResolve.json.branding.tagline -eq "Smoke test tagline")

# 7. email review request uses the email channel + template
$emailStamp = [guid]::NewGuid().ToString("N").Substring(0, 8)
$emailContact = P2-Post "$Base/api/contacts" @{
    name     = "Email Review $emailStamp"
    channels = @(@{ kind = "email"; value = "review-$emailStamp@appolo.test" })
}
$emailContactId = $emailContact.json.contact.id
T "email review contact created" ($emailContact.code -eq 201)
$emailGrant = P2-Post "$Base/api/contacts/$emailContactId/consent" @{ channel = "email"; status = "granted"; source = "smoke" }
T "email consent granted" ($emailGrant.code -eq 201)

$emailSend = P2-Post "$Base/api/review-requests" @{
    contactId    = $emailContactId
    channel      = "email"
    platformKind = "google"
    locationId   = $smokeLocationId
}
T "email review request sent" ($emailSend.code -eq 201 -and $emailSend.json.status -eq "sent")
$emailConvos = P2-Get "$Base/api/conversations?channel=email"
T "email conversation appears in the inbox" (@($emailConvos.json.conversations).Count -ge 1)

# 8. follow-up cadence sends once, then stops at the max
$followSettings = P2-Patch "$Base/api/reviews/settings" @{
    followUp = @{ enabled = $true; days = 0; max = 1; body = "Reminder: {{review_link}}" }
}
T "follow-up settings saved" ($followSettings.code -eq 200 -and $followSettings.json.settings.followUp.max -eq 1)

$follows1 = P2-Post "$Base/api/reviews/follow-ups" @{}
T "follow-up run sends reminders" ($follows1.code -eq 200 -and $follows1.json.sent -ge 1)
$follows2 = P2-Post "$Base/api/reviews/follow-ups" @{}
T "follow-up respects the max" ($follows2.code -eq 200 -and $follows2.json.sent -eq 0)

$requestsAfter = P2-Get "$Base/api/review-requests"
$followedReq = @($requestsAfter.json.requests) | Where-Object { $_.contactId -eq $emailContactId -and $_.followUpCount -ge 1 } | Select-Object -First 1
T "request records the follow-up" ($null -ne $followedReq)

# 9. review inbox + platform sync
$reviewList = P2-Get "$Base/api/reviews"
T "reviews list returns stats" ($reviewList.code -eq 200 -and $null -ne $reviewList.json.stats.total)

$sync = P2-Post "$Base/api/reviews/sync" @{}
T "review sync runs" ($sync.code -eq 200 -and $sync.json.platforms -ge 1 -and ($sync.json.imported + $sync.json.updated) -ge 1)

$reviewsHtml = Join-Path $env:TEMP "appolo_smoke_reviews.html"
$reviewsStatus = (curl.exe -s -b $p2jar -o $reviewsHtml -w "%{http_code}" "$Base/app/reviews").Trim()
$reviewsContent = Get-Content -Raw $reviewsHtml -ErrorAction SilentlyContinue
T "reviews page renders" ($reviewsStatus -eq "200" -and $reviewsContent -match "Send a review request")

# restore the demo settings and branding
P2-Patch "$Base/api/reviews/settings" @{
    timezone   = "America/Denver"
    quietHours = @{ enabled = $true; start = "21:00"; end = "08:00" }
    followUp   = @{
        enabled = $true
        days    = 3
        max     = 1
        body    = "Hi {{first_name}}, just a gentle reminder - if you have a moment, a quick review for {{business_name}} would really help us out: {{review_link}}"
    }
} | Out-Null
P2-Patch "$Base/api/reviews/branding" @{
    accentColor  = "#6366f1"
    logoUrl      = $null
    tagline      = $null
    supportEmail = $null
} | Out-Null

$reviewContactIds = @($reviewContactId, $emailContactId)
$smokeTemplateId = $templateId

Remove-Item $p2jar, $p2resp, $p2body, $landingHtml, $reviewsHtml -Force -ErrorAction SilentlyContinue

# --- Phase 3: review management, automations, campaigns, reporting ---
Write-Host ""
Write-Host "Phase 3: review management"

$p3jar = Join-Path $env:TEMP "appolo_p3_cookies.txt"
$p3resp = Join-Path $env:TEMP "appolo_p3_resp.json"
$p3body = Join-Path $env:TEMP "appolo_p3_body.json"

function P3-ReadJson($path) {
    try {
        $raw = Get-Content -Raw $path -ErrorAction Stop
        if (-not $raw) { return $null }
        return ($raw | ConvertFrom-Json)
    } catch { return $null }
}

function P3-Post($url, $obj) {
    [IO.File]::WriteAllText($p3body, ($obj | ConvertTo-Json -Compress -Depth 6))
    $code = (curl.exe -s -o $p3resp -w "%{http_code}" -b $p3jar -c $p3jar -X POST -H "Content-Type: application/json" --data "@$p3body" $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (P3-ReadJson $p3resp) }
}

function P3-Put($url, $obj) {
    [IO.File]::WriteAllText($p3body, ($obj | ConvertTo-Json -Compress -Depth 6))
    $code = (curl.exe -s -o $p3resp -w "%{http_code}" -b $p3jar -c $p3jar -X PUT -H "Content-Type: application/json" --data "@$p3body" $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (P3-ReadJson $p3resp) }
}

function P3-Patch($url, $obj) {
    [IO.File]::WriteAllText($p3body, ($obj | ConvertTo-Json -Compress -Depth 6))
    $code = (curl.exe -s -o $p3resp -w "%{http_code}" -b $p3jar -c $p3jar -X PATCH -H "Content-Type: application/json" --data "@$p3body" $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (P3-ReadJson $p3resp) }
}

function P3-Get($url) {
    $code = (curl.exe -s -o $p3resp -w "%{http_code}" -b $p3jar -c $p3jar $url).Trim()
    return [pscustomobject]@{ code = [int]$code; json = (P3-ReadJson $p3resp) }
}

# Best-effort direct SQL, used only to set up a private tag segment so a
# broadcast test never messages the seeded demo contacts.
function P3-Sql($sql) {
    if (-not $script:p3psql) {
        $pgBin = $env:PG_BIN
        if (-not $pgBin) {
            $installs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending
            foreach ($i in $installs) {
                $candidate = Join-Path $i.FullName "bin"
                if (Test-Path (Join-Path $candidate "psql.exe")) { $pgBin = $candidate; break }
            }
        }
        $script:p3psql = if ($pgBin) { Join-Path $pgBin "psql.exe" } else { $null }
        $envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"
        $dbUrl = $null
        if (Test-Path $envFile) {
            $line = Get-Content $envFile | Where-Object { $_ -match '^\s*MIGRATE_DATABASE_URL\s*=' } | Select-Object -First 1
            if ($line) { $dbUrl = ($line -split '=', 2)[1].Trim() }
        }
        if (-not $dbUrl) { $dbUrl = "postgresql://appolo@127.0.0.1:55432/appolo" }
        $script:p3db = $dbUrl
    }
    if (-not $script:p3psql -or -not (Test-Path $script:p3psql)) { return $false }
    $sql | & $script:p3psql -d $script:p3db -v ON_ERROR_STOP=1 -f - | Out-Null
    return $true
}

[IO.File]::WriteAllText($p3body, (@{ email = "owner@appolo.test"; password = "appolo-demo-1234" } | ConvertTo-Json -Compress))
curl.exe -s -c $p3jar -H "Content-Type: application/json" --data "@$p3body" "$Base/api/auth/login" | Out-Null

$me3 = P3-Get "$Base/api/me"
$ownerId = $me3.json.user.id

# 1. review inbox filters
$allReviews = P3-Get "$Base/api/reviews?limit=100"
T "reviews list returns inbox fields" ($allReviews.code -eq 200 -and $null -ne @($allReviews.json.reviews)[0].replyStatus)

$fiveOnly = P3-Get "$Base/api/reviews?rating=5"
$allFive = (@($fiveOnly.json.reviews) | Where-Object { $_.rating -ne 5 }).Count -eq 0
T "reviews filter by rating" ($fiveOnly.code -eq 200 -and $allFive)

$unanswered = P3-Get "$Base/api/reviews?replyStatus=none"
$noPosted = (@($unanswered.json.reviews) | Where-Object { $_.replyStatus -eq "posted" }).Count -eq 0
T "reviews filter to unanswered" ($unanswered.code -eq 200 -and $noPosted)

# Pick a Facebook review: the mock adapter supports replies without credentials.
$target = @($unanswered.json.reviews) | Where-Object { $_.platformKind -eq "facebook" } | Select-Object -First 1
T "there is a facebook review to reply to" ($null -ne $target)
$p3TargetId = $target.id

# 2. AI (heuristic) draft
$draft = P3-Post "$Base/api/reviews/$p3TargetId/draft" @{ tone = "friendly" }
T "AI draft created" ($draft.code -eq 201 -and $draft.json.draft.body.Length -gt 0)
T "draft is not auto-published" ($draft.json.draft.aiGenerated -eq $false)
$draftId = $draft.json.draft.replyId

# 3. publish the draft
$publish = P3-Put "$Base/api/reviews/$p3TargetId/reply" @{ replyId = $draftId }
T "reply published" ($publish.code -eq 200 -and $publish.json.status -eq "posted")
$postedList = P3-Get "$Base/api/reviews?replyStatus=posted&platformKind=facebook"
$nowPosted = @($postedList.json.reviews) | Where-Object { $_.id -eq $p3TargetId -and $_.replyStatus -eq "posted" }
T "published reply shows in the inbox" ($null -ne $nowPosted)

# 4. assignment + flag
$assign = P3-Patch "$Base/api/reviews/$p3TargetId" @{ assignedTo = $ownerId; flagged = $true }
T "review assigned and flagged" ($assign.code -eq 200)
$flagged = P3-Get "$Base/api/reviews?flagged=true"
$isFlagged = @($flagged.json.reviews) | Where-Object { $_.id -eq $p3TargetId -and $_.flagged -eq $true }
T "flagged filter returns the review" ($null -ne $isFlagged)
P3-Patch "$Base/api/reviews/$p3TargetId" @{ flagged = $false } | Out-Null

# 5. review widget + public JSON + embed
$widget = P3-Get "$Base/api/reviews/widgets"
T "review widget provisioned" ($widget.code -eq 200 -and $widget.json.widget.publicKey -like "rw_*")
$widgetKey = $widget.json.widget.publicKey

$publicWidget = P3-Get "$Base/api/public/widgets/$widgetKey"
T "public widget data is available" ($publicWidget.code -eq 200 -and $null -ne $publicWidget.json.aggregate.count)

$embedHtml = Join-Path $env:TEMP "appolo_p3_embed.html"
$embedStatus = (curl.exe -s -o $embedHtml -w "%{http_code}" "$Base/embed/reviews/$widgetKey").Trim()
$embedContent = Get-Content -Raw $embedHtml -ErrorAction SilentlyContinue
T "review widget embed renders" ($embedStatus -eq "200")
T "review widget emits JSON-LD" ($embedContent -match "aggregateRating")

# 6. reports + CSV export
$report = P3-Get "$Base/api/reports?days=90"
T "reports return a review rollup" ($report.code -eq 200 -and $report.json.report.total -ge 1)
T "reports include platform breakdown" (@($report.json.report.byPlatform).Count -ge 1)

$csvPath = Join-Path $env:TEMP "appolo_p3_reviews.csv"
$csvStatus = (curl.exe -s -b $p3jar -o $csvPath -w "%{http_code}" "$Base/api/reviews/export").Trim()
$csvContent = Get-Content -Raw $csvPath -ErrorAction SilentlyContinue
T "reviews CSV export works" ($csvStatus -eq "200" -and $csvContent -match "rating")

# 7. automations: the seeded keyword automation auto-replies
$autos = P3-Get "$Base/api/automations"
T "seeded automation is listed" ($autos.code -eq 200 -and (@(@($autos.json.automations) | Where-Object { $_.name -eq "Hours question" })).Count -ge 1)

$p3stamp = [guid]::NewGuid().ToString("N").Substring(0, 8)
$p3digits = -join (1..4 | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })
$autoContact = P3-Post "$Base/api/contacts" @{
    name     = "Auto Contact $p3stamp"
    channels = @(@{ kind = "phone"; value = "+1555556$p3digits" })
}
$p3AutoContactId = $autoContact.json.contact.id
T "automation contact created" ($autoContact.code -eq 201)
P3-Post "$Base/api/contacts/$p3AutoContactId/consent" @{ channel = "sms"; status = "granted"; source = "smoke" } | Out-Null

$autoFrom = "+1555556$p3digits"
$autoInbound = "What are your hours this weekend?"
$autoCode = Twilio-Post "+15555550100" $autoFrom $autoInbound "SM_smoke_auto_$p3stamp"
T "automation trigger accepted" ($autoCode -eq "200")

$autoConvos = P3-Get "$Base/api/conversations?channel=sms"
$autoConvo = @($autoConvos.json.conversations) | Where-Object { $_.contactId -eq $p3AutoContactId } | Select-Object -First 1
T "automation contact reached the inbox" ($null -ne $autoConvo)
$autoDetail = P3-Get "$Base/api/conversations/$($autoConvo.id)"
$autoReply = @($autoDetail.json.messages) | Where-Object { $_.direction -eq "outbound" -and $_.body -match "Mon-Fri" }
T "keyword automation auto-replied" ($null -ne $autoReply)

# 8. campaigns: preview + create + send (consent enforced per recipient)
P3-Patch "$Base/api/reviews/settings" @{ quietHours = @{ enabled = $false; start = "21:00"; end = "08:00" } } | Out-Null

# Scope the broadcast to the throwaway contact via a private tag so the seeded
# demo contacts are never messaged by the smoke run.
$segTag = "smoke-seg-$p3stamp"
$tagged = P3-Sql @"
insert into tags (org_id, name, color)
  values ((select id from orgs where slug = 'demo'), '$segTag', '#888888');
insert into contact_tags (org_id, contact_id, tag_id)
  values (
    (select id from orgs where slug = 'demo'),
    '$p3AutoContactId',
    (select id from tags where name = '$segTag' order by id limit 1)
  );
"@
T "campaign segment tag created" $tagged

$preview = P3-Get "$Base/api/campaigns?preview=1&segment=tag&tag=$segTag"
T "campaign segment preview counts contacts" ($preview.code -eq 200 -and $preview.json.recipients -eq 1)

$campaign = P3-Post "$Base/api/campaigns" @{
    name    = "Smoke Campaign $p3stamp"
    channel = "sms"
    segment = "tag"
    tag     = $segTag
    body    = "Hi {{first_name}}, thanks from {{business_name}}!"
}
T "campaign created" ($campaign.code -eq 201 -and $campaign.json.campaign.recipients -eq 1)
$campaignId = $campaign.json.campaign.id

$sendResult = P3-Post "$Base/api/campaigns/$campaignId/send" @{}
T "campaign send runs" ($sendResult.code -eq 200 -and $sendResult.json.sent -eq 1)

# restore demo review settings
P3-Patch "$Base/api/reviews/settings" @{
    timezone   = "America/Denver"
    quietHours = @{ enabled = $true; start = "21:00"; end = "08:00" }
} | Out-Null

# 9. audit log + contact timeline + phase 3 pages
$auditHtml = Join-Path $env:TEMP "appolo_p3_audit.html"
$auditStatus = (curl.exe -s -b $p3jar -o $auditHtml -w "%{http_code}" "$Base/app/audit").Trim()
$auditContent = Get-Content -Raw $auditHtml -ErrorAction SilentlyContinue
T "audit page renders" ($auditStatus -eq "200" -and $auditContent -match "Audit log")
T "audit page shows the published reply" ($auditContent -match "review.reply_published")

$timelineHtml = Join-Path $env:TEMP "appolo_p3_contact.html"
$timelineStatus = (curl.exe -s -b $p3jar -o $timelineHtml -w "%{http_code}" "$Base/app/contacts/$p3AutoContactId").Trim()
$timelineContent = Get-Content -Raw $timelineHtml -ErrorAction SilentlyContinue
T "contact timeline page renders" ($timelineStatus -eq "200" -and $timelineContent -match "Timeline")
T "contact timeline shows a message" ($timelineContent -match "Message received")

$p3pages = @("/app/automations", "/app/campaigns", "/app/reports")
foreach ($p3page in $p3pages) {
    $pageOut = Join-Path $env:TEMP ("appolo_p3_page" + ($p3page -replace "[^a-z]", "") + ".html")
    $pageStatus = (curl.exe -s -b $p3jar -o $pageOut -w "%{http_code}" "$Base$p3page").Trim()
    T "page $p3page renders" ($pageStatus -eq "200")
    Remove-Item $pageOut -Force -ErrorAction SilentlyContinue
}

# --- Phase 4: AI employee (grounded replies + human handoff) ---
Write-Host ""
Write-Host "Phase 4: AI employee"

$aiAgent = P3-Get "$Base/api/ai/agent"
T "ai agent endpoint returns a config" ($aiAgent.code -eq 200 -and $null -ne $aiAgent.json.agent.config)
T "ai agent ships disabled" ($aiAgent.json.agent.config.enabled -eq $false)

$aiDocs = P3-Get "$Base/api/ai/knowledge"
$hasHoursDoc = (@(@($aiDocs.json.docs) | Where-Object { $_.title -eq "Business hours" })).Count -ge 1
T "knowledge base is seeded" ($aiDocs.code -eq 200 -and $hasHoursDoc)

$aiHtml = Join-Path $env:TEMP "appolo_p4_ai.html"
$aiStatus = (curl.exe -s -b $p3jar -o $aiHtml -w "%{http_code}" "$Base/app/ai").Trim()
$aiContent = Get-Content -Raw $aiHtml -ErrorAction SilentlyContinue
T "AI employee page renders" ($aiStatus -eq "200" -and $aiContent -match "Knowledge base")
Remove-Item $aiHtml -Force -ErrorAction SilentlyContinue

# Enable the AI employee for the behaviour checks, then restore the seed state.
$aiEnable = P3-Patch "$Base/api/ai/agent" @{ enabled = $true }
T "ai agent can be enabled" ($aiEnable.code -eq 200 -and $aiEnable.json.agent.config.enabled -eq $true)

# A confident knowledge match gets a grounded reply from the AI.
$p4visitor = "smoke-ai-$p3stamp"
$p4ask = P3-Post "$Base/api/webchat/demo-webchat/messages" @{ visitorId = $p4visitor; body = "What time do you close on Saturday?"; name = "AI Smoke" }
T "ai webchat inbound accepted" ($p4ask.code -eq 201)
$p4contactId = $p4ask.json.contactId
$p4detail = P3-Get "$Base/api/conversations/$($p4ask.json.conversationId)"
$p4reply = @(@($p4detail.json.messages) | Where-Object { $_.direction -eq "outbound" -and $_.senderType -eq "ai" })[0]
T "ai answers from the knowledge base" ($null -ne $p4reply -and $p4reply.body -match "Saturday")

# An escalation keyword hands off to a human with an internal note.
$p4escVisitor = "smoke-ai-esc-$p3stamp"
$p4esc = P3-Post "$Base/api/webchat/demo-webchat/messages" @{ visitorId = $p4escVisitor; body = "I want to speak to a human"; name = "AI Smoke" }
$p4escContactId = $p4esc.json.contactId
$p4escDetail = P3-Get "$Base/api/conversations/$($p4esc.json.conversationId)"
$p4note = @(@($p4escDetail.json.notes) | Where-Object { $_.body -match "AI escalated" })[0]
T "ai escalates to a human with a note" ($null -ne $p4note)

# Restore the seeded disabled state.
$aiDisable = P3-Patch "$Base/api/ai/agent" @{ enabled = $false }
T "ai agent restored to disabled" ($aiDisable.code -eq 200 -and $aiDisable.json.agent.config.enabled -eq $false)

Remove-Item $p3jar, $p3resp, $p3body, $embedHtml, $csvPath, $auditHtml, $timelineHtml -Force -ErrorAction SilentlyContinue

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
        $smokeIds = @(@($contactId, $inboundContactId, $wcContactId, $p3AutoContactId, $p4contactId, $p4escContactId) + @($reviewContactIds)) |
            Where-Object { $_ -and $_ -match '^[0-9a-fA-F-]{36}$' } |
            Select-Object -Unique
        $contactDelete = ""
        if ($smokeIds.Count -gt 0) {
            $idList = ($smokeIds | ForEach-Object { "'$_'" }) -join ","
            $contactDelete = "delete from contacts where id in ($idList);"
        }

        $reviewReset = ""
        if ($p3TargetId -and $p3TargetId -match '^[0-9a-fA-F-]{36}$') {
            $reviewReset = @"
delete from review_replies where review_id = '$p3TargetId';
update reviews set reply_status = 'draft', assigned_to = null, flagged = false where id = '$p3TargetId';
"@
        }

        $cleanupSql = @"
delete from orgs where slug like 'smoke-co-%';
delete from locations where name = 'Smoke Test Site'
  and org_id = (select id from orgs where slug = 'demo');
delete from private_feedback where body = 'Smoke test private feedback';
delete from review_templates where name like 'Smoke Review %';
delete from campaigns where name like 'Smoke Campaign %';
delete from automations where name like 'Smoke Automation %';
delete from tags where name like 'smoke-seg-%';
delete from ai_knowledge_docs where title like 'Smoke KB %';
delete from contacts where name = 'AI Smoke';
update ai_agents set enabled = false,
  voice_profile = jsonb_set(voice_profile, '{enabled}', 'false'::jsonb);
$reviewReset
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