# ============================================================
#  Engage the Novation Launchpad Mini MK3.
#
#  Puts the pad into PROGRAMMER MODE via SysEx so QLC+'s shipped
#  profile (pad notes 11..88) lights and drives the console.
#  QLC+ does NOT do this itself — hence dark pads without it.
#
#  MUST run BEFORE QLC+ opens the MIDI port (Windows MIDI output is
#  single-owner: once QLC+ holds 'LPMiniMK3 MIDI' for feedback, this
#  can't open it). start-show.ps1 calls this just before launching QLC+.
#
#  Sends a brief white full-grid flash as a visible "engaged" confirm,
#  then clears (QLC+ operate-mode feedback takes over from there).
#  Pass -NoFlash to skip the flash.
#
#  Exit codes: 0 engaged · 2 not found · 3 port busy (QLC+ has it) · 4 winmm error
# ============================================================
param([switch]$NoFlash)

if (-not ('LP' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class LP {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct MIDIOUTCAPS {
    public ushort wMid; public ushort wPid; public uint vDriverVersion;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname;
    public ushort wTechnology; public ushort wVoices; public ushort wNotes;
    public ushort wChannelMask; public uint dwSupport;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MIDIHDR {
    public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded;
    public IntPtr dwUser; public uint dwFlags; public IntPtr lpNext; public IntPtr reserved;
    public uint dwOffset;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst=8)] public IntPtr[] dwReserved;
  }
  [DllImport("winmm.dll")] static extern uint midiOutGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint midiOutGetDevCaps(UIntPtr id, ref MIDIOUTCAPS c, uint cb);
  [DllImport("winmm.dll")] static extern uint midiOutOpen(out IntPtr h, uint id, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern uint midiOutClose(IntPtr h);
  [DllImport("winmm.dll")] static extern uint midiOutShortMsg(IntPtr h, uint msg);
  [DllImport("winmm.dll")] static extern uint midiOutPrepareHeader(IntPtr h, ref MIDIHDR hd, uint cb);
  [DllImport("winmm.dll")] static extern uint midiOutUnprepareHeader(IntPtr h, ref MIDIHDR hd, uint cb);
  [DllImport("winmm.dll")] static extern uint midiOutLongMsg(IntPtr h, ref MIDIHDR hd, uint cb);

  public static string PortName = "(none)";

  static int FindPort() {
    uint n = midiOutGetNumDevs();
    int exact = -1, partial = -1;
    for (uint i=0;i<n;i++){
      var c=new MIDIOUTCAPS();
      midiOutGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(c));
      if (c.szPname=="LPMiniMK3 MIDI") { exact=(int)i; PortName=c.szPname; }
      else if (partial<0 && c.szPname.Contains("LPMiniMK3") && !c.szPname.Contains("MIDIOUT2")) { partial=(int)i; if(exact<0) PortName=c.szPname; }
    }
    return exact>=0?exact:partial;
  }

  static void SendSysEx(IntPtr h, byte[] data) {
    IntPtr buf = Marshal.AllocHGlobal(data.Length);
    Marshal.Copy(data, 0, buf, data.Length);
    var hd = new MIDIHDR();
    hd.lpData = buf; hd.dwBufferLength=(uint)data.Length; hd.dwBytesRecorded=(uint)data.Length;
    hd.dwReserved = new IntPtr[8];
    if (midiOutPrepareHeader(h, ref hd, (uint)Marshal.SizeOf(hd))==0) {
      midiOutLongMsg(h, ref hd, (uint)Marshal.SizeOf(hd));
      midiOutUnprepareHeader(h, ref hd, (uint)Marshal.SizeOf(hd));
    }
    Marshal.FreeHGlobal(buf);
  }

  static void Grid(IntPtr h, int vel) {
    for(int row=1;row<=8;row++) for(int col=1;col<=8;col++){
      int note=row*10+col;
      midiOutShortMsg(h,(uint)(0x90 | (note<<8) | (vel<<16)));
    }
  }

  // 0 ok, 2 not found, 3 busy, 4 other winmm error
  public static int Engage(bool flash) {
    int id = FindPort();
    if (id<0) return 2;
    IntPtr h;
    uint r = midiOutOpen(out h, (uint)id, IntPtr.Zero, IntPtr.Zero, 0);
    if (r==4) return 3;          // MIDIERR_ALLOCATED — another app (QLC+) owns it
    if (r!=0) return 4;
    SendSysEx(h, new byte[]{0xF0,0x00,0x20,0x29,0x02,0x0D,0x0E,0x01,0xF7}); // Programmer mode ON
    Thread.Sleep(80);
    if (flash) { Grid(h, 3); Thread.Sleep(450); Grid(h, 0); }              // white flash, then clear
    Thread.Sleep(30);
    midiOutClose(h);
    return 0;
  }
}
"@
}

$r = [LP]::Engage(-not $NoFlash)
switch ($r) {
  0 { Write-Host "  Launchpad: Programmer Mode engaged (port: $([LP]::PortName))." -ForegroundColor Green; exit 0 }
  2 { Write-Host '  [!] Launchpad not found (no "LPMiniMK3 MIDI" port). Check the USB cable.' -ForegroundColor Yellow; exit 2 }
  3 { Write-Host '  [!] Launchpad MIDI port busy — close QLC+ first; engage must run before QLC+ opens it.' -ForegroundColor Yellow; exit 3 }
  default { Write-Host '  [!] Launchpad engage failed (winmm error).' -ForegroundColor Yellow; exit 4 }
}
