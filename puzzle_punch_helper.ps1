# ============================================================
#  DELVE HELPER
#  Serves the game at http://localhost:8747/ and files each
#  run's telemetry under telemetry\ next to this script, so
#  runs can be discussed with Claude afterwards.
#  Also keeps the all-time high score in highscore.json, so it
#  survives browser resets, different browsers, everything.
#
#  Run via "Launch Puzzle Punch.bat" (recommended) or:
#    powershell -ExecutionPolicy Bypass -File puzzle_punch_helper.ps1
#
#  Keep this window open while you play. Close it to stop.
#  (Opened without the helper, the game still works — telemetry
#   just falls back to the T-key download.)
# ============================================================

$ErrorActionPreference = 'Stop'
$Port = 8747
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$gamePath = Join-Path $root 'PUZZLE PUNCH.html'
$studioPath = Join-Path $root 'PUZZLE PUNCH — DEV STUDIO.html'

function Send-Bytes($ctx, [byte[]]$bytes, $ct, [int]$code = 200) {
  $res = $ctx.Response
  $res.StatusCode = $code
  $res.Headers['Access-Control-Allow-Origin']  = '*'
  $res.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  $res.Headers['Cache-Control'] = 'no-store'
  if ($ct) { $res.ContentType = $ct }
  $res.ContentLength64 = $bytes.Length
  if ($bytes.Length -gt 0) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  $res.OutputStream.Close()
}
function Send-Json($ctx, $obj, [int]$code = 200) {
  $json = $obj | ConvertTo-Json -Compress
  Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' $code
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Cyan
Write-Host '   DELVE HELPER                  [ running ]'   -ForegroundColor Cyan
Write-Host '   build: v12 (v11 + /combat — THE COMBAT STUDIO''s presets in combat-studio.json, PUZZLE PUNCH v0.84p)' -ForegroundColor DarkCyan
Write-Host '  ============================================' -ForegroundColor Cyan
Write-Host "   Game:      http://localhost:$Port/"
Write-Host "   Studio:    http://localhost:$Port/studio"
Write-Host '   Telemetry: telemetry\  (one JSON per run)'
Write-Host ''
Write-Host '   Keep this window open while you play.'
Write-Host '   Close this window to stop.' -ForegroundColor DarkGray
Write-Host ''

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      if ($ctx.Request.HttpMethod -eq 'OPTIONS') { Send-Bytes $ctx ([byte[]]@()) $null 204; continue }
      $path = $ctx.Request.Url.AbsolutePath
      switch -Regex ($path) {
        '^/$|^/game/?$' {
          if (Test-Path $gamePath) {
            Send-Bytes $ctx ([IO.File]::ReadAllBytes($gamePath)) 'text/html; charset=utf-8'
          } else {
            Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes('PUZZLE PUNCH.html not found next to the helper script.')) 'text/plain' 404
          }
        }
        '^/studio/?$' {  # v8: THE DEV STUDIO — a reference manual that drives the game through DELVE.debug
          if (Test-Path $studioPath) {
            Send-Bytes $ctx ([IO.File]::ReadAllBytes($studioPath)) 'text/html; charset=utf-8'
          } else {
            Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes('PUZZLE PUNCH — DEV STUDIO.html not found next to the helper script.')) 'text/plain' 404
          }
        }
        '^/telemetry/list$' {  # v8: the studio's telemetry module — every run file, newest first
          $dir = Join-Path $root 'telemetry'
          $list = @()
          if (Test-Path $dir) {
            $list = @(Get-ChildItem -Path $dir -Filter '*.json' | Sort-Object LastWriteTime -Descending |
                      ForEach-Object { @{ name = $_.Name; bytes = $_.Length; mtime = $_.LastWriteTime.ToString('o') } })
          }
          Send-Json $ctx @{ ok = $true; files = $list }
        }
        '^/telemetry/file$' {  # v8: one run file by name (?name=...), never a path
          $name = $ctx.Request.QueryString['name']
          $name = [IO.Path]::GetFileName([string]$name)
          $file = Join-Path (Join-Path $root 'telemetry') $name
          if ($name -and $name -like '*.json' -and (Test-Path $file)) {
            Send-Bytes $ctx ([IO.File]::ReadAllBytes($file)) 'application/json; charset=utf-8'
          } else {
            Send-Json $ctx @{ ok = $false; error = 'no such run' } 404
          }
        }
        '^/telemetry$' {  # the game mails its run log here; we file it under telemetry\ next door
          $run = $ctx.Request.QueryString['run']
          if (-not $run) { $run = Get-Date -Format 'yyyy-MM-dd HHmmss' }
          $run = ($run -replace '[^0-9A-Za-z\-\. _]', '').Trim()
          if ($run.Length -gt 40) { $run = $run.Substring(0, 40) }
          if (-not $run) { $run = 'unstamped' }
          $dir = Join-Path $root 'telemetry'
          if (-not (Test-Path $dir)) { $null = New-Item -ItemType Directory -Path $dir }
          $enc = $ctx.Request.ContentEncoding
          if (-not $enc) { $enc = [Text.Encoding]::UTF8 }
          $reader = New-Object IO.StreamReader($ctx.Request.InputStream, $enc)
          $text = $reader.ReadToEnd()
          $reader.Close()
          [IO.File]::WriteAllText((Join-Path $dir ("delve-run $run.json")), $text)
          Send-Json $ctx @{ ok = $true }
        }
        '^/combat$' {  # v12: THE COMBAT STUDIO's presets and slots, kept in combat-studio.json next door
          $combatPath = Join-Path $root 'combat-studio.json'
          if ($ctx.Request.HttpMethod -eq 'POST') {
            $enc = $ctx.Request.ContentEncoding
            if (-not $enc) { $enc = [Text.Encoding]::UTF8 }
            $reader = New-Object IO.StreamReader($ctx.Request.InputStream, $enc)
            $text = $reader.ReadToEnd()
            $reader.Close()
            try {
              $null = $text | ConvertFrom-Json
              [IO.File]::WriteAllText($combatPath, $text)
              Send-Json $ctx @{ ok = $true; helper = 12 }
            } catch { Send-Json $ctx @{ ok = $false; error = 'bad payload' } 400 }
          } elseif (Test-Path $combatPath) {
            Send-Bytes $ctx ([IO.File]::ReadAllBytes($combatPath)) 'application/json; charset=utf-8'
          } else {
            Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes('{"v":1,"presets":[],"slots":[null,null,null],"last":null}')) 'application/json; charset=utf-8'
          }
        }
        '^/highscore$' {  # persistent records, kept in highscore.json next door
          # v6: THE HELPER NO LONGER KNOWS THE LEVEL LIST, and that is the fix.
          # v5 hard-coded @('depths','castle','forest') in TWO places, so every
          # new level needed a helper edit and a helper that had missed one
          # silently misfiled its records into the depths. It now takes ids as
          # it finds them — whatever is already in the file, plus whatever the
          # game POSTs — so this never needs touching again. The seed list
          # below exists only so a fresh highscore.json is readable by a human;
          # it is not a gate, and an id absent from it still files correctly.
          # v4: PER-LEVEL records — {levels:{depths:{hi,fastAny,fast100},castle:{...}}}.
          # hi = max, times = min (>0). Old flat files ({"hi":N} or the v3 shape)
          # migrate into levels.depths on first read. `hi` at the top level
          # mirrors depths.hi so a human opening the file still sees the number.
          # v7: each record carries the LOADOUT that set it (hiLoad/fastAnyLoad/
          # fast100Load — "p1main/p1thrown/p2main" strings). A stamp only moves
          # when its record does, so a v6 game POSTing without stamps can
          # improve a number without erasing who set it — the stamp just goes
          # stale-empty and the game re-stamps on its next record.
          $file = Join-Path $root 'highscore.json'
          $levels = @{}
          $newRec = { @{ hi = 0; fastAny = 0.0; fast100 = 0.0; hiLoad = ''; fastAnyLoad = ''; fast100Load = ''; enrage = 0; enrageLoad = '' } }   # v10: enrage — the highest enrage ESCAPED WITH (PUZZLE PUNCH v0.81)
          foreach ($id in @('depths', 'castle', 'forest', 'desert')) { $levels[$id] = & $newRec }
          if (Test-Path $file) {
            try {
              $j = Get-Content $file -Raw | ConvertFrom-Json
              if ($j.PSObject.Properties['levels']) {
                foreach ($prop in $j.levels.PSObject.Properties) {
                  $id = $prop.Name
                  if (-not $levels.ContainsKey($id)) { $levels[$id] = & $newRec }
                  try { $levels[$id].hi      = [int]$prop.Value.hi }        catch {}
                  try { $levels[$id].fastAny = [double]$prop.Value.fastAny } catch {}
                  try { $levels[$id].fast100 = [double]$prop.Value.fast100 } catch {}
                  try { if ($prop.Value.hiLoad)      { $levels[$id].hiLoad      = [string]$prop.Value.hiLoad } }      catch {}
                  try { if ($prop.Value.fastAnyLoad) { $levels[$id].fastAnyLoad = [string]$prop.Value.fastAnyLoad } } catch {}
                  try { if ($prop.Value.fast100Load) { $levels[$id].fast100Load = [string]$prop.Value.fast100Load } } catch {}
                  try { if ($prop.Value.enrage)      { $levels[$id].enrage      = [int]$prop.Value.enrage } }        catch {}
                  try { if ($prop.Value.enrageLoad)  { $levels[$id].enrageLoad  = [string]$prop.Value.enrageLoad } }  catch {}
                }
              } else {   # v3-or-older flat file feeds the depths
                try { $levels['depths'].hi      = [int]$j.hi }          catch {}
                try { $levels['depths'].fastAny = [double]$j.fastAny }  catch {}
                try { $levels['depths'].fast100 = [double]$j.fast100 }  catch {}
              }
            } catch {}
          }
          if ($ctx.Request.HttpMethod -eq 'POST') {
            $enc = $ctx.Request.ContentEncoding
            if (-not $enc) { $enc = [Text.Encoding]::UTF8 }
            $reader = New-Object IO.StreamReader($ctx.Request.InputStream, $enc)
            $text = $reader.ReadToEnd()
            $reader.Close()
            try {
              $p = $text | ConvertFrom-Json
              # v9: RESET RECORDS (PUZZLE PUNCH v0.76 §9.1). An optional `reset` field is read BEFORE the
              # max/min merge and instead of it — a reset POST carries the game's current numbers only
              # incidentally, and merging them would re-file the very records it is clearing.
              #   'fast100' — zero fast100 + fast100Load on every level in the file (the mini veins changed
              #               what the 100 % race asks for, so every old 100 % time was set on another race)
              #   'all'     — re-seed every level: high score, any %, 100 % and their loadout stamps
              # A v8 helper ignores the field and answers with the records it still holds; the game reads the
              # answer back and says HELPER TOO OLD when a number it cleared is still standing.
              $resetWhat = ''
              try { if ($p.reset) { $resetWhat = [string]$p.reset } } catch {}
              # v11: RESET ONE LEVEL (PUZZLE PUNCH v0.83a) — `resetLevel`: re-seed that one level (high score, any %, 100 %,
              # enrage and their stamps) and leave the others alone. Its own field, not a `reset` value, so a v10 helper
              # (which reads only `reset`) cannot mistake it for the all-levels 100 % reset; it merges nothing instead.
              $resetLevel = ''
              try { if ($p.resetLevel) { $resetLevel = [string]$p.resetLevel } } catch {}
              if ($resetLevel) {
                $levels[$resetLevel] = & $newRec
                $doc = @{ hi = $levels['depths'].hi; levels = $levels }
                [IO.File]::WriteAllText($file, ($doc | ConvertTo-Json -Compress -Depth 5))
                Write-Host ("  [reset] level " + $resetLevel) -ForegroundColor Yellow
                Send-Json $ctx @{ ok = $true; resetLevel = $resetLevel; helper = 12; levels = $levels }
              } elseif ($resetWhat) {
                foreach ($id in @($levels.Keys)) {
                  if ($resetWhat -eq 'all') { $levels[$id] = & $newRec }
                  else { $levels[$id].fast100 = 0.0; $levels[$id].fast100Load = '' }
                }
                $doc = @{ hi = $levels['depths'].hi; levels = $levels }
                [IO.File]::WriteAllText($file, ($doc | ConvertTo-Json -Compress -Depth 5))
                Write-Host ("  [reset] " + $resetWhat) -ForegroundColor Yellow
                Send-Json $ctx @{ ok = $true; reset = $resetWhat; helper = 12; levels = $levels }
              } else {   # v9b-else: the merge is SKIPPED on a reset (a `return` here would exit the script, not the switch)
              $id = 'depths'
              # v6: an unknown id is CREATED, not swallowed. The old line
              # required ContainsKey, so a level the helper had never heard of
              # quietly banked its record into the depths.
              try { if ($p.level) { $id = [string]$p.level } } catch {}
              if (-not $levels.ContainsKey($id)) { $levels[$id] = & $newRec }
              $r = $levels[$id]
              # v7: a stamp moves ONLY with its record (>= for hi so a re-POST
              # of the same best still carries its own stamp forward)
              try { if ([int]$p.hi -ge $r.hi -and [int]$p.hi -gt 0) {
                      $r.hi = [int]$p.hi
                      try { if ($p.hiLoad) { $r.hiLoad = [string]$p.hiLoad } } catch {}
                    } } catch {}
              try { $t = [double]$p.fastAny
                    if ($t -gt 0 -and ($r.fastAny -le 0 -or $t -le $r.fastAny)) { $r.fastAny = $t
                      try { if ($p.fastAnyLoad) { $r.fastAnyLoad = [string]$p.fastAnyLoad } } catch {} } } catch {}
              try { $t = [double]$p.fast100
                    if ($t -gt 0 -and ($r.fast100 -le 0 -or $t -le $r.fast100)) { $r.fast100 = $t
                      try { if ($p.fast100Load) { $r.fast100Load = [string]$p.fast100Load } } catch {} } } catch {}
              # v10: the enrage record — max, and its stamp moves only with it (the game POSTs it on a WIN only)
              try { if ([int]$p.enrage -ge $r.enrage -and [int]$p.enrage -gt 0) {
                      $r.enrage = [int]$p.enrage
                      try { if ($p.enrageLoad) { $r.enrageLoad = [string]$p.enrageLoad } } catch {}
                    } } catch {}
              $doc = @{ hi = $levels['depths'].hi; levels = $levels }
              [IO.File]::WriteAllText($file, ($doc | ConvertTo-Json -Compress -Depth 5))
              Send-Json $ctx @{ ok = $true; helper = 12; levels = $levels }
              }
            } catch { Send-Json $ctx @{ ok = $false; error = 'bad payload' } 400 }
          } else {
            Send-Json $ctx @{ hi = $levels['depths'].hi; helper = 12; levels = $levels }   # v11: the build, so the game can tell a v10 still running
          }
        }
        default { Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes('not found')) 'text/plain' 404 }
      }
    } catch {
      Write-Host "  [warn] $_" -ForegroundColor Yellow
      try { Send-Json $ctx @{ ok = $false; error = "$_" } 500 } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
