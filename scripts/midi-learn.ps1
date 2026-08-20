# ============================================================
#  MIDI learn — sniff a controller and print what each control sends.
#
#  QLC+ binds inputs by CHANNEL NUMBER, so before a knob or fader can drive
#  anything we have to know the CC number it emits. Auto-detect inside QLC+
#  needs a human at both ends; this prints the map so it can go into the show
#  generator instead.
#
#  Usage:
#    ./scripts/midi-learn.ps1                     # list input ports, then sniff the MiniLab
#    ./scripts/midi-learn.ps1 -Port "Minilab3"    # sniff a specific port (substring match)
#    ./scripts/midi-learn.ps1 -Seconds 90         # longer session
#
#  Move ONE control at a time and pause between them; the summary groups by
#  CC so the order you touched them is the order they are listed.
#
#  Does not send anything and does not touch QLC+. Safe to run while the show
#  is up — but note QLC+ owns the Launchpad port, so sniff the MiniLab only.
# ============================================================
param(
  [string]$Port = "Minilab3",
  [int]$Seconds = 60
)
$ErrorActionPreference = 'Stop'

if (-not ('MidiLearn' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;

public static class MidiLearn {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct INCAPS { public ushort wMid, wPid; public uint v;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname; public uint dwSupport; }

  public delegate void MidiInProc(IntPtr h, uint msg, IntPtr inst, uint p1, uint p2);

  [DllImport("winmm.dll")] static extern uint midiInGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint midiInGetDevCaps(UIntPtr id, ref INCAPS c, uint cb);
  [DllImport("winmm.dll")] static extern uint midiInOpen(out IntPtr h, uint id, MidiInProc cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern uint midiInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern uint midiInStop(IntPtr h);
  [DllImport("winmm.dll")] static extern uint midiInClose(IntPtr h);

  const uint CALLBACK_FUNCTION = 0x00030000;
  const uint MIM_DATA = 0x3C3;

  static IntPtr H = IntPtr.Zero;
  static MidiInProc Keep;            // must outlive the callback or the GC eats it
  public static ConcurrentQueue<uint> Q = new ConcurrentQueue<uint>();

  public static int Count() { return (int)midiInGetNumDevs(); }
  public static string Name(int i) {
    var c = new INCAPS();
    midiInGetDevCaps((UIntPtr)(uint)i, ref c, (uint)Marshal.SizeOf(c));
    return c.szPname;
  }
  public static int Find(string needle) {
    for (int i = 0; i < Count(); i++)
      if (Name(i).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return i;
    return -1;
  }
  static void OnMsg(IntPtr h, uint msg, IntPtr inst, uint p1, uint p2) {
    if (msg == MIM_DATA) Q.Enqueue(p1);
  }
  public static uint Open(int id) {
    Keep = new MidiInProc(OnMsg);
    uint r = midiInOpen(out H, (uint)id, Keep, IntPtr.Zero, CALLBACK_FUNCTION);
    if (r != 0) return r;
    return midiInStart(H);
  }
  public static void Close() {
    if (H != IntPtr.Zero) { midiInStop(H); midiInClose(H); H = IntPtr.Zero; }
  }
}
"@
}

Write-Host ''
Write-Host '  MIDI input ports:' -ForegroundColor Cyan
for ($i = 0; $i -lt [MidiLearn]::Count(); $i++) {
  Write-Host ("    [{0}] {1}" -f $i, [MidiLearn]::Name($i))
}

$id = [MidiLearn]::Find($Port)
if ($id -lt 0) {
  Write-Host "  [!] No input port matching '$Port'. Plug it in, or pass -Port with part of a name above." -ForegroundColor Yellow
  exit 2
}
$rc = [MidiLearn]::Open($id)
if ($rc -ne 0) {
  Write-Host "  [!] Could not open '$([MidiLearn]::Name($id))' (winmm error $rc). Another app probably holds it." -ForegroundColor Yellow
  exit 3
}

Write-Host ''
Write-Host ("  Listening on [{0}] {1} for {2}s." -f $id, [MidiLearn]::Name($id), $Seconds) -ForegroundColor Green
Write-Host '  Move ONE control at a time, pause a beat between them. Ctrl+C to stop early.' -ForegroundColor Green
Write-Host ''

# CC number -> what we saw, in the order controls were first touched
$seen = [ordered]@{}
$deadline = (Get-Date).AddSeconds($Seconds)
try {
  while ((Get-Date) -lt $deadline) {
    $raw = 0
    while ([MidiLearn]::Q.TryDequeue([ref]$raw)) {
      $status = $raw -band 0xFF
      $d1 = ($raw -shr 8) -band 0x7F
      $d2 = ($raw -shr 16) -band 0x7F
      $type = $status -band 0xF0
      $chan = ($status -band 0x0F) + 1
      $key = switch ($type) {
        0xB0 { "CC $d1 (ch$chan)" }
        0x90 { if ($d2 -gt 0) { "Note $d1 on (ch$chan)" } else { "Note $d1 off (ch$chan)" } }
        0x80 { "Note $d1 off (ch$chan)" }
        0xE0 { "PitchBend (ch$chan)" }
        0xD0 { "Aftertouch (ch$chan)" }
        default { $null }
      }
      if (-not $key) { continue }
      if (-not $seen.Contains($key)) {
        $seen[$key] = [pscustomobject]@{ Key = $key; Count = 0; Min = 127; Max = 0 }
        Write-Host ("  + {0}" -f $key) -ForegroundColor Cyan
      }
      $e = $seen[$key]
      $e.Count++
      if ($d2 -lt $e.Min) { $e.Min = $d2 }
      if ($d2 -gt $e.Max) { $e.Max = $d2 }
    }
    Start-Sleep -Milliseconds 40
  }
} finally {
  [MidiLearn]::Close()
}

Write-Host ''
Write-Host '  ---- what this controller sends, in the order you touched it ----' -ForegroundColor Cyan
if ($seen.Count -eq 0) {
  Write-Host '  (nothing) — wrong port, or the controller is in a mode that sends elsewhere.' -ForegroundColor Yellow
} else {
  $seen.Values | ForEach-Object {
    $kind = if ($_.Max - $_.Min -gt 8 -and $_.Count -gt 6) { 'continuous (knob/fader)' } else { 'switch (pad/button)' }
    Write-Host ("  {0,-22} msgs {1,4}   range {2,3}..{3,-3}  {4}" -f $_.Key, $_.Count, $_.Min, $_.Max, $kind)
  }
}
Write-Host ''
