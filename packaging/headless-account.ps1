# What headless-task.mjs needs from Windows to run the connector as a named account (Plan 6.3.0
# Step 5b, ADR-0024 S9): its SID and profile, the batch logon right through the LSA API, a logon
# check, the task registered with a stored password. Windows PowerShell 5.1, no module.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File headless-account.ps1 <verb> ...
#     sid <account>                     its SID
#     profile <sid>                     its profile folder; nothing when it never signed in
#     prepare <account>                 grants SeBatchLogonRight if it lacks it and checks a batch
#                                       logon; prints {"sid":"S-1-...","granted":true|false}
#     register <task> <xmlFile> <account>   registers the task with the account's password
#     revoke <sid>                      takes SeBatchLogonRight away again
# prepare and register read the password from stdin, one line of base64 of its UTF-8 (stdin to
# powershell.exe is read in the OEM code page, which loses a "ü"). It is never an argument and
# nothing here prints it. Exit 0 ok, 1 failed, 3 the account can't sign in with that password
# (wrong, disabled, locked, expired), 4 no such account, 6 a policy refuses it the batch logon
# (a domain GPO that sets "Log on as a batch job").
param(
  [Parameter(Mandatory)][string]$Verb,
  [string]$A,
  [string]$B,
  [string]$C
)
$ErrorActionPreference = 'Stop'

function Read-Password {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
}

function Get-Sid([string]$Account) {
  try {
    (New-Object Security.Principal.NTAccount($Account)).Translate([Security.Principal.SecurityIdentifier]).Value
  } catch {
    [Console]::Error.WriteLine("no account $Account")
    exit 4
  }
}

function Add-Native {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class HeadlessAccount {
  [StructLayout(LayoutKind.Sequential)] struct US { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct OA { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public int Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }
  [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref OA attrs, int access, out IntPtr handle);
  [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr h, byte[] sid, US[] rights, int count);
  [DllImport("advapi32.dll")] static extern uint LsaRemoveAccountRights(IntPtr h, byte[] sid, bool all, US[] rights, int count);
  [DllImport("advapi32.dll")] static extern uint LsaEnumerateAccountRights(IntPtr h, byte[] sid, out IntPtr rights, out int count);
  [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr h);
  [DllImport("advapi32.dll")] static extern uint LsaFreeMemory(IntPtr p);
  [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint status);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool LogonUserW(string user, string domain, string password, int type, int provider, out IntPtr token);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  const uint NOT_FOUND = 0xC0000034;
  const int ACCESS = 0x00000800 | 0x00000010 | 0x00000001; // lookup names, create account, view local
  const string BATCH = "SeBatchLogonRight";
  static void Check(uint s) { if (s != 0) throw new Win32Exception(LsaNtStatusToWinError(s)); }
  static IntPtr Open() { var oa = new OA(); IntPtr h; Check(LsaOpenPolicy(IntPtr.Zero, ref oa, ACCESS, out h)); return h; }
  static byte[] Sid(string sid) { var s = new SecurityIdentifier(sid); var b = new byte[s.BinaryLength]; s.GetBinaryForm(b, 0); return b; }
  static US[] Batch() { return new[] { new US { Length = (ushort)(BATCH.Length * 2), MaximumLength = (ushort)(BATCH.Length * 2 + 2), Buffer = Marshal.StringToHGlobalUni(BATCH) } }; }
  public static bool HasBatch(string sid) {
    var h = Open();
    try {
      IntPtr p; int n;
      uint s = LsaEnumerateAccountRights(h, Sid(sid), out p, out n);
      if (s == NOT_FOUND) return false;
      Check(s);
      var size = Marshal.SizeOf(typeof(US));
      var found = false;
      for (int i = 0; i < n; i++) {
        var u = (US)Marshal.PtrToStructure(new IntPtr(p.ToInt64() + i * size), typeof(US));
        if (Marshal.PtrToStringUni(u.Buffer, u.Length / 2) == BATCH) found = true;
      }
      LsaFreeMemory(p);
      return found;
    } finally { LsaClose(h); }
  }
  public static void AddBatch(string sid) { var h = Open(); try { Check(LsaAddAccountRights(h, Sid(sid), Batch(), 1)); } finally { LsaClose(h); } }
  public static void RemoveBatch(string sid) {
    var h = Open();
    try { uint s = LsaRemoveAccountRights(h, Sid(sid), false, Batch(), 1); if (s != NOT_FOUND) Check(s); } finally { LsaClose(h); }
  }
  /** 0, or the Win32 error of a batch logon (the logon the task makes). */
  public static int BatchLogon(string user, string domain, string password) {
    IntPtr token;
    if (!LogonUserW(user, domain, password, 4, 0, out token)) return Marshal.GetLastWin32Error();
    CloseHandle(token);
    return 0;
  }
}
'@
}

switch ($Verb) {
  'sid' { Get-Sid $A }
  'profile' {
    $p = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$A" -ErrorAction SilentlyContinue
    if ($p) { [Environment]::ExpandEnvironmentVariables($p.ProfileImagePath) }
  }
  'prepare' {
    $password = Read-Password
    $sid = Get-Sid $A
    Add-Native
    $granted = $false
    if (-not [HeadlessAccount]::HasBatch($sid)) {
      [HeadlessAccount]::AddBatch($sid)
      $granted = $true
    }
    # DOMAIN\name, or a UPN (name@domain) with no domain of its own.
    $user = $A; $domain = $null
    if ($A.Contains('\')) { $domain, $user = $A.Split('\', 2) }
    $err = [HeadlessAccount]::BatchLogon($user, $domain, $password)
    if ($err -ne 0) {
      if ($granted) { [HeadlessAccount]::RemoveBatch($sid) }
      [Console]::Error.WriteLine("$A can't sign in as a batch job: $((New-Object ComponentModel.Win32Exception($err)).Message) ($err)")
      # 1385: the logon type isn't granted, although it was just added here: a policy overrides it.
      exit $(if ($err -eq 1385) { 6 } else { 3 })
    }
    "{`"sid`":`"$sid`",`"granted`":$($granted.ToString().ToLower())}"
  }
  'register' {
    $password = Read-Password
    try {
      Register-ScheduledTask -TaskPath '\' -TaskName $A -Xml (Get-Content -Raw -LiteralPath $B) -User $C -Password $password -Force | Out-Null
    } catch {
      [Console]::Error.WriteLine($_.Exception.Message)
      exit 1
    }
  }
  'revoke' {
    Add-Native
    [HeadlessAccount]::RemoveBatch($A)
  }
  default {
    [Console]::Error.WriteLine("unknown verb $Verb")
    exit 1
  }
}
