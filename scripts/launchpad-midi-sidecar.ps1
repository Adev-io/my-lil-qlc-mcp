# ============================================================
#  Launchpad MIDI OUT sidecar — a DUMB, resident pipe to the Novation
#  Launchpad Mini MK3's LEDs. The MCP server's launchpad module (src/launchpad/leds.ts)
#  spawns this and feeds it one MIDI message per stdin line; the sidecar forwards the
#  bytes to the device and nothing else. All colour / flash / page logic lives in the
#  TypeScript module — this side just owns the winmm port so we don't pull a native
#  MIDI dependency into the Node install.
#
#  Why a separate process: Windows MIDI output is single-owner. QLC+ is now configured
#  MIDI-INPUT-ONLY on the Launchpad (no <Feedback> line in the show), so this sidecar can
#  hold the OUT port for the whole session and drive the pads with true RGB SysEx.
#
#  Protocol (stdin, one message per line):
#    - Hex bytes of ONE complete MIDI message, space-separated, e.g.
#        F0 00 20 29 02 0D 0E 01 F7                 (Programmer Mode ON)
#        F0 00 20 29 02 0D 03 03 51 7F 00 00 F7     (light pad note 0x51 full red, RGB SysEx)
#      A line starting with F0 is sent as SysEx (midiOutLongMsg); anything else as a short message.
#    - "BYE"  -> blacks out the grid, closes the port, exits 0.
#    - EOF (parent closes our stdin / dies) -> same clean shutdown.
#
#  winmm P/Invoke is the same proven path as engage-launchpad.ps1.
#  Exit codes: 0 clean · 2 port not found · 3 port busy (something else owns OUT) · 4 winmm error
# ============================================================
$ErrorActionPreference = 'Stop'

if (-not ('LPOut' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class LPOut {
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
  static IntPtr H = IntPtr.Zero;

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

  // 0 ok, 2 not found, 3 busy, 4 other winmm error
  public static int Open() {
    int id = FindPort();
    if (id<0) return 2;
    uint r = midiOutOpen(out H, (uint)id, IntPtr.Zero, IntPtr.Zero, 0);
    if (r==4) return 3;          // MIDIERR_ALLOCATED — another app owns it
    if (r!=0) return 4;
    return 0;
  }

  static void SendSysEx(byte[] data) {
    IntPtr buf = Marshal.AllocHGlobal(data.Length);
    Marshal.Copy(data, 0, buf, data.Length);
    var hd = new MIDIHDR();
    hd.lpData = buf; hd.dwBufferLength=(uint)data.Length; hd.dwBytesRecorded=(uint)data.Length;
    hd.dwReserved = new IntPtr[8];
    if (midiOutPrepareHeader(H, ref hd, (uint)Marshal.SizeOf(hd))==0) {
      midiOutLongMsg(H, ref hd, (uint)Marshal.SizeOf(hd));
      midiOutUnprepareHeader(H, ref hd, (uint)Marshal.SizeOf(hd));
    }
    Marshal.FreeHGlobal(buf);
  }

  public static void Send(byte[] data) {
    if (H==IntPtr.Zero || data==null || data.Length==0) return;
    if (data[0]==0xF0) { SendSysEx(data); }
    else {
      int s = data[0], d1 = data.Length>1?data[1]:0, d2 = data.Length>2?data[2]:0;
      midiOutShortMsg(H, (uint)(s | (d1<<8) | (d2<<16)));
    }
  }

  public static void AllOff() {
    if (H==IntPtr.Zero) return;
    for(int row=1;row<=8;row++) for(int col=1;col<=8;col++){
      int note=row*10+col;
      midiOutShortMsg(H,(uint)(0x90 | (note<<8) | 0));   // Programmer-mode note off
    }
  }

  public static void Close() {
    if (H!=IntPtr.Zero) { midiOutClose(H); H=IntPtr.Zero; }
  }
}
"@
}

$code = [LPOut]::Open()
if ($code -ne 0) {
  [Console]::Error.WriteLine("ERR open code=$code")   # 2 not found · 3 busy · 4 winmm
  exit $code
}
[Console]::Out.WriteLine("READY $([LPOut]::PortName)")
[Console]::Out.Flush()

try {
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    $line = $line.Trim()
    if ($line -eq '') { continue }
    if ($line -eq 'BYE') { break }
    try {
      $bytes = [byte[]]($line -split '\s+' | ForEach-Object { [Convert]::ToByte($_, 16) })
      [LPOut]::Send($bytes)
    } catch {
      [Console]::Error.WriteLine("ERR badline: $line")
    }
  }
} finally {
  [LPOut]::AllOff()
  [LPOut]::Close()
}
exit 0
