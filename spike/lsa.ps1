# Throwaway spike, Plan 6.3.0 Step 5b: a user right through the LSA API (no secedit, no dependency).
#   . spike/lsa.ps1; [SpikeLsa]::Add($sid, 'SeBatchLogonRight'); [SpikeLsa]::Get($sid); [SpikeLsa]::Remove(...)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class SpikeLsa {
  [StructLayout(LayoutKind.Sequential)] struct US { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct OA { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public int Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }
  [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref OA attrs, int access, out IntPtr handle);
  [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr h, byte[] sid, US[] rights, int count);
  [DllImport("advapi32.dll")] static extern uint LsaRemoveAccountRights(IntPtr h, byte[] sid, bool all, US[] rights, int count);
  [DllImport("advapi32.dll")] static extern uint LsaEnumerateAccountRights(IntPtr h, byte[] sid, out IntPtr rights, out int count);
  [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr h);
  [DllImport("advapi32.dll")] static extern uint LsaFreeMemory(IntPtr p);
  [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint status);
  const int ACCESS = 0x00000800 | 0x00000010 | 0x00000001; // lookup names, create account, view local
  static void Check(uint s) { if (s != 0) throw new Win32Exception(LsaNtStatusToWinError(s)); }
  static IntPtr Open() { var oa = new OA(); IntPtr h; Check(LsaOpenPolicy(IntPtr.Zero, ref oa, ACCESS, out h)); return h; }
  static byte[] Sid(string sid) { var s = new SecurityIdentifier(sid); var b = new byte[s.BinaryLength]; s.GetBinaryForm(b, 0); return b; }
  static US[] One(string right) { return new[] { new US { Length = (ushort)(right.Length * 2), MaximumLength = (ushort)(right.Length * 2 + 2), Buffer = Marshal.StringToHGlobalUni(right) } }; }
  public static string[] Get(string sid) {
    var h = Open();
    try {
      IntPtr p; int n;
      uint s = LsaEnumerateAccountRights(h, Sid(sid), out p, out n);
      if (s == 0xC0000034) return new string[0]; // no rights at all
      Check(s);
      var list = new List<string>();
      int size = Marshal.SizeOf(typeof(US));
      for (int i = 0; i < n; i++) { var u = (US)Marshal.PtrToStructure(new IntPtr(p.ToInt64() + i * size), typeof(US)); list.Add(Marshal.PtrToStringUni(u.Buffer, u.Length / 2)); }
      LsaFreeMemory(p);
      return list.ToArray();
    } finally { LsaClose(h); }
  }
  public static void Add(string sid, string right) { var h = Open(); try { Check(LsaAddAccountRights(h, Sid(sid), One(right), 1)); } finally { LsaClose(h); } }
  public static void Remove(string sid, string right) { var h = Open(); try { Check(LsaRemoveAccountRights(h, Sid(sid), false, One(right), 1)); } finally { LsaClose(h); } }
}
'@
