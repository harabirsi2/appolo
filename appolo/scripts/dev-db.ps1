param([switch]$Stop)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root ".pgdata"
$log = Join-Path $root ".pgdata\server.log"
$port = 55432

function Find-PgBin {
    $candidates = @()
    if ($env:PG_BIN) { $candidates += $env:PG_BIN }
    $installs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    foreach ($i in $installs) { $candidates += (Join-Path $i.FullName "bin") }
    $cmd = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += (Split-Path -Parent $cmd.Source) }
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "pg_ctl.exe")) { return $c }
    }
    throw "PostgreSQL bin not found. Install PostgreSQL or set PG_BIN to its bin folder."
}

$bin = Find-PgBin
$pgCtl = Join-Path $bin "pg_ctl.exe"
$psql = Join-Path $bin "psql.exe"
$initdb = Join-Path $bin "initdb.exe"
$createdb = Join-Path $bin "createdb.exe"

if ($Stop) {
    if (Test-Path $data) {
        & $pgCtl -D $data stop -m fast
        "stopped local postgres ($data)"
    } else {
        "no local cluster at $data"
    }
    exit 0
}

if (-not (Test-Path $data)) {
    "initializing local postgres cluster at $data"
    & $initdb -D $data -U appolo -A trust -E UTF8 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "initdb failed (do not run this elevated)" }
}

$status = & $pgCtl -D $data status 2>&1
if ($LASTEXITCODE -ne 0) {
    "starting postgres on port $port"
    # Start-Process with a pre-quoted argument string: paths contain spaces, and
    # piping pg_ctl would hang because the server inherits the pipe handle.
    $argStr = '-D "{0}" -l "{1}" -o "-p {2}" -w -t 60 start' -f $data, $log, $port
    $proc = Start-Process -FilePath $pgCtl -ArgumentList $argStr -PassThru -WindowStyle Hidden
    $null = $proc.WaitForExit(90000)
    if ($proc.ExitCode -ne 0) { throw "pg_ctl start failed (exit $($proc.ExitCode)); see $log" }
} else {
    "postgres already running"
}

if (-not (Test-Path $psql)) { throw "psql.exe not found at '$psql' (bin='$bin')" }
$existsOut = & $psql -h 127.0.0.1 -p $port -U appolo -d postgres -tAc "select 1 from pg_database where datname='appolo'"
$exists = ("{0}" -f $existsOut).Trim()
if ($exists -ne "1") {
    & $createdb -h 127.0.0.1 -p $port -U appolo appolo
    "created database appolo"
}

$roleSql = @"
do `$`$ begin
  if not exists (select 1 from pg_roles where rolname = 'appolo_app') then
    create role appolo_app login password 'appolo_dev_password';
  end if;
end `$`$;
"@
$roleSql | & $psql -h 127.0.0.1 -p $port -U appolo -d appolo -v ON_ERROR_STOP=1 -f - | Out-Null

if (-not (Test-Path (Join-Path $root ".env"))) {
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
    "created .env from .env.example"
}

""
"local postgres ready"
"  host : 127.0.0.1"
"  port : $port"
"  data : $data"
"  app  : postgresql://appolo_app:appolo_dev_password@127.0.0.1:$port/appolo"
""
"next:"
"  pnpm db:migrate"
"  pnpm db:seed"
"  pnpm dev"
""
"stop with: powershell -ExecutionPolicy Bypass -File scripts/dev-db.ps1 -Stop"