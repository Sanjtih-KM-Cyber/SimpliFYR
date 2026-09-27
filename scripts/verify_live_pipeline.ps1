<#
.SYNOPSIS
  Phase 0 end-to-end verification for the Simplifyr live pipeline.

.DESCRIPTION
  Proves ingest -> pipeline -> storage -> quarantine -> mapping ->
  normalization against a RUNNING backend. Creates clearly-labeled test
  data (source "Phase0-Verify-<stamp>") and removes it afterwards.

  Requires: backend already running (it never starts/stops servers).

.PARAMETER BaseUrl
  API root, e.g. http://127.0.0.1:8000

.PARAMETER SyslogPort
  UDP syslog port the backend listens on (default 5514).

.PARAMETER TimeoutSec
  Per-step wait budget while polling for async pipeline processing.

.EXAMPLE
  .\verify_live_pipeline.ps1 -BaseUrl http://127.0.0.1:8000 -SyslogPort 5514
#>
param(
  [string]$BaseUrl = "http://127.0.0.1:8000",
  [int]$SyslogPort = 5514,
  [int]$TimeoutSec = 25
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")
$stamp = Get-Date -Format "HHmmss"
$source = "Phase0-Verify-$stamp"
$markerIp = "10.99.$([int]$stamp.Substring(0,2)).$([int]$stamp.Substring(2,2) + 1)"
$failures = @()
$createdEventIds = @()
$createdMappingId = $null

function Assert($condition, $label, $detail = "") {
  if ($condition) { Write-Host "  [PASS] $label" }
  else {
    Write-Host "  [FAIL] $label $detail"
    $script:failures += $label
  }
}

function Send-Syslog([string]$line) {
  $udp = New-Object Net.Sockets.UdpClient
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($line)
    [void]$udp.Send($bytes, $bytes.Length, "127.0.0.1", $SyslogPort)
  } finally { $udp.Close() }
}

function Wait-For([scriptblock]$predicate, [string]$what) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { if (& $predicate) { return $true } } catch { }
    Start-Sleep -Seconds 1
  }
  Write-Host "  [TIMEOUT] waiting for: $what"
  return $false
}

try {
  Write-Host "[1/5] Backend health ($BaseUrl)"
  $health = Invoke-RestMethod -Uri "$BaseUrl/api/v1/health" -TimeoutSec 5
  Assert ($health.status -eq "ok" -and $health.database -eq "ok") "API + database healthy" ($health | ConvertTo-Json -Compress)

  Write-Host "[2/5] UDP syslog ingest -> stored as quarantined (no source, no mapping)"
  $before = (Invoke-RestMethod -Uri "$BaseUrl/api/v1/stats").total_events
  Send-Syslog "<134>Oct 26 13:00:01 phase0fw srcip=$markerIp dstip=8.8.4.4 proto=tcp action=deny"
  $arrived = Wait-For {
    (Invoke-RestMethod -Uri "$BaseUrl/api/v1/stats").total_events -gt $before
  } "event count increments past $before"
  $ev = $null
  if ($arrived) {
    $list = Invoke-RestMethod -Uri "$BaseUrl/api/v1/events?limit=5"
    $ev = @($list | Where-Object { $_.event_id })[0]
    if ($ev) { $ev = Invoke-RestMethod -Uri "$BaseUrl/api/v1/events/$($ev.id)"; $script:createdEventIds += $ev.id }
  }
  Assert ($arrived -and $ev -ne $null) "datagram processed and stored"
  Assert ($ev -ne $null -and $ev.status -eq "quarantined") "unmapped event quarantined (fail-safe)" "got: $($ev.status)"
  Assert ($ev -ne $null -and $ev.views.raw.Contains($markerIp)) "raw payload preserved verbatim"
  Assert ($ev -ne $null -and $ev.detected_format -eq "syslog") "format detected as syslog" "got: $($ev.detected_format)"

  Write-Host "[3/5] Publish mapping for $source"
  $mappingBody = @{
    name   = "$source Mapping"
    source = $source
    fields = @(
      @{input_field = "srcip"; semantic_field = "source.ip"},
      @{input_field = "dstip"; semantic_field = "destination.ip"},
      @{input_field = "proto"; semantic_field = "network.protocol"},
      @{input_field = "action"; semantic_field = "network.action"; transformation = @{deny = "BLOCKED"; allow = "ALLOWED"}}
    )
  } | ConvertTo-Json -Depth 6
  $mapping = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/mappings" -ContentType "application/json" -Body $mappingBody
  $script:createdMappingId = $mapping.id
  $published = Invoke-RestMethod -Method Patch -Uri "$BaseUrl/api/v1/mappings/$($mapping.id)" -ContentType "application/json" -Body '{"status":"published"}'
  Assert ($published.status -eq "published") "mapping published" "got: $($published.status)"

  Write-Host "[4/5] Attributed re-send -> normalized with provenance"
  $raw2 = "<134>Oct 26 13:00:02 phase0fw srcip=$markerIp dstip=8.8.4.4 proto=tcp action=deny"
  $ing = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/ingest" -Body @{raw = $raw2; source = $source}
  $script:createdEventIds += $ing.stored_event_id
  Assert ($ing.status -eq "normalized") "event normalized via mapping" "got: $($ing.status)"
  Assert ($ing.normalized.source.ip -eq $markerIp) "source.ip mapped" "got: $($ing.normalized.source.ip)"
  Assert ($ing.normalized.network.action -eq "BLOCKED") "transformation applied (deny to BLOCKED)" "got: $($ing.normalized.network.action)"
  Assert ($ing.provenance.mapping.id -eq $mapping.id) "provenance references mapping" "got: $(($ing.provenance.mapping | ConvertTo-Json -Compress))"

  Write-Host "[5/5] Cleanup test data"
  $cleanOk = $true
  foreach ($id in $script:createdEventIds) {
    try { Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/v1/events/$id" | Out-Null }
    catch { $cleanOk = $false; Write-Host "  [WARN] could not delete event ${id}: $($_.Exception.Message)" }
  }
  if ($script:createdMappingId) {
    try { Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/v1/mappings/$($script:createdMappingId)" | Out-Null }
    catch { $cleanOk = $false; Write-Host "  [WARN] could not delete mapping $($script:createdMappingId): $($_.Exception.Message)" }
  }
  Assert $cleanOk "test events and mapping removed"
} catch {
  Write-Host "  [ERROR] $($_.Exception.Message)"
  $failures += "unexpected exception"
}

Write-Host ""
if ($failures.Count -eq 0) { Write-Host "RESULT: PASS - live pipeline verified end to end."; exit 0 }
else { $msg = $failures -join "; "; Write-Host "RESULT: FAIL - $msg"; exit 1 }
