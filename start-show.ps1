# ============================================================
#  One-shot full launcher for the QLC+ lighting stack.
#  Brings up every connection in the rig, in order:
#
#    QLC+ (your rig.json show)  -> Launchpad MIDI IN (pad presses only, universe 1)
#                               -> MiniLab 3 MIDI IN (knobs/faders, universe 2)
#                               -> Art-Net  Universe 0  (to 3D monitor + real rig)
#                               -> OSC in   (driven by the MCP server)
#    MCP server (HTTP mode)     -> dashboard + OSC control  -> QLC+ :9000
#                               -> Launchpad LED OUT (RGB SysEx via a winmm sidecar)
#    3D monitor                 -> listens to Art-Net U0     -> Three.js on :7800
#
#  Then opens the 3D monitor and the dashboard in the browser.
#  Idempotent: skips any piece already up. Each long-running piece runs
#  in its own window so it survives independently of this script.
#
#  The Launchpad LEDs are driven by QLC+ MIDI feedback (the show's <Feedback> line): idle pads wait
#  dim, the active look lights full until toggled off. This needs Programmer Mode engaged BEFORE
#  QLC+ opens the MIDI ports — step 0 below runs engage-launchpad.ps1. If pads stay dark, reseat
#  the Launchpad USB and re-run this script. (The MCP SysEx LED driver stays LAUNCHPAD_LEDS=0 in
#  config/.env — it needs QLC+ OSC feedback, which this QLC+ install never emits.)
# ============================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# QLC+ 4.14.x executable: $env:QLC_EXE overrides; otherwise common install locations.
$qlc = @(
  $env:QLC_EXE,
  'C:\QLC+4\qlcplus.exe',
  "$env:ProgramFiles\QLC+\qlcplus.exe",
  "${env:ProgramFiles(x86)}\QLC+\qlcplus.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

# Show file + controller come from rig.json (the .qxw filename is the show name's slug —
# ASCII version of scripts/rig.ts slugify). No rig.json = first run: the rig-setup-wizard
# agent (open Claude Code here) interviews you and writes it; fall back to the example.
$useLaunchpad = $true
$rigFile = Join-Path $here 'rig.json'
if (Test-Path $rigFile) {
  $rig  = Get-Content $rigFile -Raw | ConvertFrom-Json
  $slug = ($rig.meta.name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
  $show = Join-Path $here "$slug.qxw"
  if ($null -ne $rig.controller) { $useLaunchpad = [bool]$rig.controller.launchpad }
} else {
  Write-Host '  [!] No rig.json — first run? Open Claude Code here and ask the rig-setup-wizard to set you up.' -ForegroundColor Yellow
  Write-Host '      Falling back to the example show (punk-rock-show.qxw).' -ForegroundColor Yellow
  $show = Join-Path $here 'punk-rock-show.qxw'
}
if (-not (Test-Path $show)) {
  Write-Host "  [!] Show file not found: $show — run 'npm run generate' first." -ForegroundColor Yellow
  exit 1
}

$monPort = if ($env:MONITOR_PORT) { $env:MONITOR_PORT } else { '7800' }
$mcpPort = if ($env:HTTP_PORT)    { $env:HTTP_PORT }    else { '8788' }
$monUrl  = "http://127.0.0.1:$monPort"
$dashUrl = "http://127.0.0.1:$mcpPort/dashboard"

function Test-Url($u) {
  try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 1 | Out-Null; return $true } catch { return $false }
}
function Wait-Url($u, $tries = 40) {
  for ($i = 0; $i -lt $tries; $i++) {
    if (Test-Url $u) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

Write-Host ''
Write-Host "  $([System.IO.Path]::GetFileNameWithoutExtension($show)) — full launch" -ForegroundColor Cyan
Write-Host "  QLC+       : $show"
Write-Host "  MCP + dash : $dashUrl"
Write-Host "  3D monitor : $monUrl"
Write-Host ''

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Host '  [!] npx not found on PATH. Install Node 20+ and try again.' -ForegroundColor Yellow
  exit 1
}

# 0. Launchpad Programmer Mode — engage BEFORE QLC+ opens the MIDI ports so QLC+'s profile
#    (pad notes 11..88) can read presses and light the pads via MIDI feedback.
if ($useLaunchpad -and -not (Get-Process qlcplus -ErrorAction SilentlyContinue)) {
  & (Join-Path $here 'engage-launchpad.ps1')

  # HARD PREFLIGHT (learned on the rig 2026-08-20). rig.controller.inputUid/Line are winmm device
  # INDEXES, not names, and those indexes MOVE when any MIDI device is added, removed or replugged
  # (this machine also has loopMIDI + FLStudioMCP virtual ports). Point the show at the wrong index
  # and QLC+ reads that device's traffic as pad presses: looks fire continuously with nobody
  # touching anything, and the rig looks possessed. So resolve 'LPMiniMK3 MIDI' by NAME every
  # launch and compare with what the show was generated against.
  if (-not ('MIDX' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MIDX {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct INCAPS { public ushort wMid, wPid; public uint v;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname; public uint dwSupport; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct OUTCAPS { public ushort wMid, wPid; public uint v;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname;
    public ushort wTechnology, wVoices, wNotes, wChannelMask; public uint dwSupport; }
  [DllImport("winmm.dll")] static extern uint midiInGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint midiInGetDevCaps(UIntPtr id, ref INCAPS c, uint cb);
  [DllImport("winmm.dll")] static extern uint midiOutGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint midiOutGetDevCaps(UIntPtr id, ref OUTCAPS c, uint cb);
  public static int In(string name) {
    for (uint i = 0; i < midiInGetNumDevs(); i++) { var c = new INCAPS();
      midiInGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(c)); if (c.szPname == name) return (int)i; }
    return -1; }
  public static int Out(string name) {
    for (uint i = 0; i < midiOutGetNumDevs(); i++) { var c = new OUTCAPS();
      midiOutGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(c)); if (c.szPname == name) return (int)i; }
    return -1; }
}
"@
  }
  # SECOND port. The Mini MK3 exposes two: 'LPMiniMK3 MIDI' (the DAW port) and 'MIDIIN2/MIDIOUT2
  # (LPMiniMK3 MIDI)' — Programmer-mode pad notes travel on the second one (SETUP-MANUAL step 4;
  # the punk rig ran on it for months). Caught 2026-08-20: matching the bare name bound the DAW
  # port, so QLC+ was listening to a port the pads never speak on.
  $lpIn  = [MIDX]::In('MIDIIN2 (LPMiniMK3 MIDI)')
  $lpOut = [MIDX]::Out('MIDIOUT2 (LPMiniMK3 MIDI)')
  # MiniLab 3 optional second MIDI universe for knobs/faders
  $mlName = $null
  if ($rig.controller2 -and $rig.controller2.portName) { $mlName = $rig.controller2.portName }
  $mlIn = -1
  if ($mlName) { $mlIn = [MIDX]::In($mlName) }
  if ($lpIn -lt 0 -or $lpOut -lt 0) {
    Write-Host ''
    Write-Host '  [!!] LAUNCHPAD NOT CONNECTED — and the show maps MIDI by device INDEX.' -ForegroundColor Red
    Write-Host "       QLC+ will bind index $($rig.controller.inputUid) to whatever MIDI device sits there instead," -ForegroundColor Yellow
    Write-Host '       and stray traffic on it fires looks at random. Plug the Launchpad in and re-run.' -ForegroundColor Yellow
    Write-Host ''
  } elseif ("$lpIn" -ne "$($rig.controller.inputUid)" -or "$lpOut" -ne "$($rig.controller.outputUid)" -or `
            ($mlIn -ge 0 -and "$mlIn" -ne "$($rig.controller2.inputUid)")) {
    # REPAIR, don't just complain. Watched live 2026-08-20: plugging in an Arturia Minilab3 (four
    # MIDI ports, sorting before "LPMiniMK3") moved the Launchpad from index 3 to 7 between two
    # launches. Telling the operator to edit rig.json and regenerate is not a thing anyone should
    # be doing an hour before doors, so patch the two attributes in place. Same contract as
    # scripts/floor-head-tilt.mjs: back up first, and never block the launch.
    Write-Host ''
    Write-Host '  [!] MIDI indexes moved — repairing.' -ForegroundColor Yellow
    Write-Host "      show was built for in=$($rig.controller.inputUid) out=$($rig.controller.outputUid); Launchpad is now in=$lpIn out=$lpOut" -ForegroundColor Yellow
    try {
      $autosave = Join-Path (Split-Path $show -Parent) ([System.IO.Path]::GetFileNameWithoutExtension($show) + '.autosave.qxw')
      $utf8 = New-Object System.Text.UTF8Encoding($false)
      foreach ($f in @($show, $autosave)) {
        if (-not (Test-Path $f)) { continue }
        $t = [System.IO.File]::ReadAllText($f)
        # UID="[^"]*": QLC+ rewrites the UID as the device NAME when it autosaves, so \d+ skipped the autosave.
        # Per-universe repair: isolate each <Universe> block so Launchpad patches don't touch MiniLab.
        $fixUni = {
          param($xml, $uniName, $inIdx, $outIdx)
          $pat = '(?s)(<Universe Name="' + [regex]::Escape($uniName) + '" ID="\d+"[^>]*>)(.*?)(</Universe>)'
          [regex]::Replace($xml, $pat, [System.Text.RegularExpressions.MatchEvaluator]{
            param($m)
            $body = $m.Groups[2].Value
            $body = $body -replace '<Input Plugin="MIDI" UID="[^"]*" Line="\d+"/>', ('<Input Plugin="MIDI" UID="' + $inIdx + '" Line="' + $inIdx + '"/>')
            if ($null -ne $outIdx) { $body = $body -replace '<Feedback Plugin="MIDI" UID="[^"]*" Line="\d+"/>', ('<Feedback Plugin="MIDI" UID="' + $outIdx + '" Line="' + $outIdx + '"/>') }
            $m.Groups[1].Value + $body + $m.Groups[3].Value
          })
        }
        $n = & $fixUni $t 'Launchpad' $lpIn $lpOut
        if ($mlIn -ge 0) { $n = & $fixUni $n 'MiniLab' $mlIn $null }
        if ($n -eq $t) { continue }
        Copy-Item $f "$f.midibak" -Force
        $ro = (Get-Item $f).IsReadOnly            # the generated show ships read-only
        if ($ro) { Set-ItemProperty $f -Name IsReadOnly -Value $false }
        [System.IO.File]::WriteAllText($f, $n, $utf8)
        if ($ro) { Set-ItemProperty $f -Name IsReadOnly -Value $true }
        Write-Host "      patched $([System.IO.Path]::GetFileName($f)) [backup: $([System.IO.Path]::GetFileName($f)).midibak]" -ForegroundColor Green
      }
      # Keep rig.json in step by text, not ConvertTo-Json, so the file's formatting survives —
      # otherwise the next "npm run generate" would hand the stale index straight back.
      $rt = [System.IO.File]::ReadAllText($rigFile)
      # Anchor Launchpad patches to "controller" block so they don't touch "controller2"
      $rt = [regex]::Replace($rt, '(?s)("controller"\s*:\s*\{[^}]*?"inputUid"\s*:\s*")\d+(")',  ('${1}' + $lpIn + '${2}'))
      $rt = [regex]::Replace($rt, '(?s)("controller"\s*:\s*\{[^}]*?"inputLine"\s*:\s*")\d+(")', ('${1}' + $lpIn + '${2}'))
      $rt = [regex]::Replace($rt, '(?s)("controller"\s*:\s*\{[^}]*?"outputUid"\s*:\s*")\d+(")',  ('${1}' + $lpOut + '${2}'))
      $rt = [regex]::Replace($rt, '(?s)("controller"\s*:\s*\{[^}]*?"outputLine"\s*:\s*")\d+(")', ('${1}' + $lpOut + '${2}'))
      # MiniLab patches anchor to "controller2" block (has nested "cc" object, so use .*? not [^}]*)
      if ($mlIn -ge 0) {
        $rt = [regex]::Replace($rt, '(?s)("controller2"\s*:\s*\{.*?"inputUid"\s*:\s*")\d+(")',  ('${1}' + $mlIn + '${2}'))
        $rt = [regex]::Replace($rt, '(?s)("controller2"\s*:\s*\{.*?"inputLine"\s*:\s*")\d+(")', ('${1}' + $mlIn + '${2}'))
      }
      [System.IO.File]::WriteAllText($rigFile, $rt, $utf8)
      Write-Host '      rig.json updated to match.' -ForegroundColor Green
    } catch {
      Write-Host "  [!!] repair failed: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host '       Set controller.inputUid/inputLine + outputUid/outputLine in rig.json by hand,' -ForegroundColor Yellow
      Write-Host '       run "npm run generate", and re-run this launcher before trusting the pads.' -ForegroundColor Yellow
    }
    Write-Host ''
  } else {
    Write-Host "  -> Launchpad MIDI index check OK (in=$lpIn out=$lpOut)" -ForegroundColor DarkGray
  }
  # MiniLab status — print in every branch so it shows whether available or not
  if ($mlIn -ge 0) {
    Write-Host "  -> MiniLab MIDI index in=$mlIn" -ForegroundColor DarkGray
  } elseif ($mlName) {
    Write-Host "  [!] MiniLab ($mlName) not found - knobs/faders stay unbound this launch" -ForegroundColor Yellow
  }
}

# 1. QLC+ — reads Launchpad MIDI IN (pad presses), lights the pads via MIDI feedback (the show's
#    <Feedback> line: dim idle / bright active), Art-Net U0 out + OSC in.
if (Get-Process qlcplus -ErrorAction SilentlyContinue) {
  Write-Host '  -> QLC+ already running' -ForegroundColor DarkGray
} elseif ($qlc) {
  # COVER FLOOR (2026-06-12): before QLC+ opens the show, clamp every moving-head tilt to >=
  # horizontal so no cue or stray edit can aim a beam up into the canopy (and zero any banned
  # firmware movement-macro). Idempotent — no-op when already safe — and fail-safe: a clamp
  # error is logged but never blocks the show. See scripts/floor-head-tilt.mjs.
  $floorScript = Join-Path $here 'scripts/floor-head-tilt.mjs'
  if ((Test-Path $floorScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $floorTargets = @($show)
    $autoFile = Join-Path (Split-Path $show -Parent) ([System.IO.Path]::GetFileNameWithoutExtension($show) + '.autosave.qxw')
    if (Test-Path $autoFile) { $floorTargets += $autoFile }
    try { & node $floorScript @floorTargets } catch { Write-Host "  [!] cover-floor step error (continuing): $($_.Exception.Message)" -ForegroundColor Yellow }
  } else {
    Write-Host '  [!] cover-floor step skipped (node or floor script missing)' -ForegroundColor DarkGray
  }
  Write-Host '  -> launching QLC+ (Operate) ...' -ForegroundColor Green
  Start-Process $qlc -ArgumentList '--open', $show, '--operate'
} else {
  Write-Host '  [!] QLC+ 4 not found (looked in C:\QLC+4 and Program Files).' -ForegroundColor Yellow
  Write-Host '      Install QLC+ 4.14.x from qlcplus.org, or set $env:QLC_EXE to your qlcplus.exe path.' -ForegroundColor Yellow
}

# 2. MCP server (HTTP mode) — dashboard + OSC control to QLC+ :9000.
if (Test-Url "http://127.0.0.1:$mcpPort/health") {
  Write-Host "  -> MCP server already on :$mcpPort" -ForegroundColor DarkGray
} else {
  Write-Host '  -> launching MCP server (HTTP) ...' -ForegroundColor Green
  $mcpCmd = "`$env:MCP_TRANSPORT='http'; `$env:HTTP_PORT='$mcpPort'; Set-Location '$here'; npx tsx src/index.ts"
  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $mcpCmd
}

# 3. 3D monitor — Art-Net U0 -> Three.js on :7800.
if (Test-Url "$monUrl/status") {
  Write-Host "  -> 3D monitor already on :$monPort" -ForegroundColor DarkGray
} else {
  Write-Host '  -> launching 3D monitor ...' -ForegroundColor Green
  $monCmd = "Set-Location '$here'; npx tsx monitor/server.ts"
  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $monCmd
}

# 4. Wait for the web services, then open both tabs.
Write-Host ''
Write-Host '  waiting for services ...' -ForegroundColor Green
$mcpOk = Wait-Url "http://127.0.0.1:$mcpPort/health"
$monOk = Wait-Url "$monUrl/status"

if ($monOk) { Start-Process $monUrl }  else { Write-Host '  [!] 3D monitor did not answer'  -ForegroundColor Yellow }
if ($mcpOk) { Start-Process $dashUrl } else { Write-Host '  [!] MCP/dashboard did not answer' -ForegroundColor Yellow }

# 5. BOOT LIT (party shows only). Party looks set colour, never brightness -- the R7 dim row owns
#    that -- so a freshly opened show sits dark until a dim pad is pressed. Fire "Dim Full" once so
#    the rig comes up lit. The path is read from the generated LED map rather than hard-coded, so
#    a pad move does not silently break this. UDP OSC has no ACK and QLC+ may still be loading:
#    if nothing lights, press R7C4 on the Launchpad -- that is the same function.
if ($rig -and $rig.meta.builder -eq 'party') {
  $ledMap = Join-Path $here 'config/launchpad-leds.json'
  $oscScript = Join-Path $here 'scripts/send-osc.mjs'
  if ((Test-Path $ledMap) -and (Test-Path $oscScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $bootPad = (Get-Content $ledMap -Raw | ConvertFrom-Json).pads |
      Where-Object { $_.path -like '/dim_full_p1*' } | Select-Object -First 1
    if ($bootPad) {
      # Wait for QLC+ to actually be emitting before firing. This is a SOLO toggle, so it cannot
      # simply be retried — a second press turns it back off. The monitor's lastFrameAt is the
      # readiness signal: while QLC+ is still loading the show no Art-Net arrives and the age
      # climbs. Seen for real: firing too early left the rig dark at boot.
      for ($i = 0; $i -lt 30; $i++) {
        try {
          $st = Invoke-WebRequest "$monUrl/status" -UseBasicParsing -TimeoutSec 1 | ForEach-Object { $_.Content } | ConvertFrom-Json
          if ($st.ageMs -lt 1500) { break }
        } catch { }
        Start-Sleep -Milliseconds 500
      }
      Write-Host "  -> boot lit: firing $($bootPad.path)" -ForegroundColor Green
      try { & node $oscScript $bootPad.path 1 | Out-Null }
      catch { Write-Host "  [!] boot-lit OSC failed (press R7C4 instead): $($_.Exception.Message)" -ForegroundColor Yellow }

      # BOOT AIM. Looks set colour, never position, so until a position scene runs the heads sit
      # at pan 0 / tilt 0 -- a hard mechanical extreme, and not a direction anyone chose. Send them
      # to their home aim at startup: truss on the dance floor, floor pair on the banner. Resolved
      # by widget NAME from the generated map so renaming a pad cannot silently break it.
      $wjson = Join-Path $here 'config/widgets.json'
      if (Test-Path $wjson) {
        $ws = (Get-Content $wjson -Raw | ConvertFrom-Json).widgets
        foreach ($n in @('Truss Home', 'Banner Home')) {
          $w = $ws | Where-Object { $_.name -eq $n } | Select-Object -First 1
          if ($w) {
            try { & node $oscScript $w.path 1 | Out-Null; Write-Host "  -> boot aim: $($w.path)" -ForegroundColor Green }
            catch { Write-Host "  [!] boot-aim OSC failed for $n (press it on the dashboard): $($_.Exception.Message)" -ForegroundColor Yellow }
          } else {
            Write-Host "  [!] boot-aim skipped: no '$n' widget in config/widgets.json" -ForegroundColor DarkGray
          }
        }
      }
    } else {
      Write-Host '  [!] boot-lit skipped: no /dim_full_p1 pad in config/launchpad-leds.json' -ForegroundColor DarkGray
    }
  }
}

Write-Host ''
Write-Host '  Up. QLC+ in Operate; the MCP server drives the Launchpad LEDs. If pads are dark, check the MCP window or reseat the Launchpad USB, then re-run.' -ForegroundColor Cyan
Write-Host ''
