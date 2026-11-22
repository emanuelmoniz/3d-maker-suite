; Per-user Windows installer, no admin (ADR-0011), for the app or the connector (ADR-0014). Built by
; packaging/build.mjs: iscc /DVersion=4.1.0 /DSrc=<folder with node\ launcher.mjs product.json versions\>
; /DOutDir=<dir> /DOutName=<name> [/DName=<product name> /DAppId=<product id> /DAlwaysStart /DHeadless] setup.iss
; AlwaysStart: start at login without asking (the connector only helps while it runs).
; Headless (the connector, ADR-0024): start at boot with nobody signed in instead, as a scheduled
; task that headless-task.mjs registers. Only for all users (/ALLUSERS, elevated, in Program Files):
; a named account can't run Node from another user's profile (Plan 6.3.0 Step 5b), and setup run
; that way is always headless. It runs as this administrator (S4U), or as /ACCOUNT with the password
; in /PASSWORDFILE (read and deleted), which reaches network shares. Silent, for Server Core:
;   setup.exe /VERYSILENT /SUPPRESSMSGBOXES /ALLUSERS /HEADLESS /HUBURL=https://hub /PAIRINGCODE=AB12-CD34
;             [/NAME="Server"] [/ACCOUNT=DOMAIN\name /PASSWORDFILE=C:\path\pw.txt]
; Run again without them, it keeps the task's address, code, name and account. Exit code 8: the task
; wasn't set up (the reason is in logs\headless-task.log); 1: /HEADLESS without /ALLUSERS.
#ifndef Name
  #define Name "3D Maker Suite"
#endif
#ifndef AppId
  #define AppId "3d-maker-suite"
#endif
#define Start "{app}\node\nodew.exe"

[Setup]
AppId={#AppId}
AppName={#Name}
AppVersion={#Version}
AppPublisherURL=https://github.com/emanuelmoniz/3d-maker-suite
; {userpf} (%LOCALAPPDATA%\Programs) per user, Program Files for all users (headless only).
DefaultDirName={autopf}\{#Name}
PrivilegesRequired=lowest
#ifdef Headless
PrivilegesRequiredOverridesAllowed=commandline
#endif
DisableProgramGroupPage=yes
DisableDirPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#Src}\icon.ico
UninstallDisplayIcon={app}\icon.ico
OutputDir={#OutDir}
OutputBaseFilename={#OutName}
; The default (yes) also reaches the [Run] launcher, contrary to the docs: it then can't follow the
; junctions it makes in versions\ and the first start fails. Setup runs unelevated as the user who
; owns the install dir, so the guard protects nothing here.
RedirectionGuard=no

[CustomMessages]
StartAtLogin=Start {#Name} when I sign in
#ifdef Headless
HeadlessGroup=Windows Server:
Headless=Start at boot with nobody signed in (headless)
HubPageCaption=Pair with the hub
HubPageDescription=Make a pairing code in the hub's Settings → Hub management.
HubPageNote=The connector pairs when it first starts. Leave the address and code empty to keep the ones it has. It runs as this administrator, which can't reach network shares; for a share (\\nas\share), enter an account and its password.
HubUrl=Hub address (for example https://maker.example.com):
PairingCode=Pairing code:
DeviceName=Name of this machine on the hub:
Account=Run as (DOMAIN\name, or .\name for an account on this server):
Password=Its password (only for another account, or to change it):
HeadlessNeedsHub=Enter the hub address and the pairing code.
HeadlessNeedsAllUsers=Starting at boot with nobody signed in installs {#Name} for all users. In an administrator PowerShell, run the setup again with /ALLUSERS, for example: .\setup.exe /ALLUSERS
HeadlessDesktopInstalled={#Name} is already installed for this account, as a desktop connector. Uninstall it first, then run this setup again.
HeadlessNeedsPassword=Enter the password of %1. The connector runs as it, with its password stored by Windows.
HeadlessGmsa=%1 is a managed service account (gMSA), which isn't supported yet. Enter an account with a password.
HeadlessBadLogon=%1 can't sign in with that password (wrong, disabled, locked or expired). Run setup again with the right one. The reason is in logs\headless-task.log in %2.
HeadlessNoAccount=There is no account %1. Run setup again with an existing account.
HeadlessPasswordAgain=The connector runs as %1 with its password. Run setup again with the password to change the hub address, code or name.
HeadlessBatchRefused=A policy doesn't let %1 run as a batch job, which the scheduled task needs. On a domain, add it to "Log on as a batch job" in the group policy, then run setup again.
HeadlessFailed={#Name} couldn't be set to start at boot. See logs\headless-task.log in %1.
#endif

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Check: not StartsHeadless
#ifndef AlwaysStart
Name: startatlogin; Description: "{cm:StartAtLogin}"; Flags: unchecked
#endif
#ifdef Headless
; Per user it only says how to start setup for all users; for all users it is always headless.
Name: headless; Description: "{cm:Headless}"; GroupDescription: "{cm:HeadlessGroup}"; Flags: unchecked; Check: not IsAdminInstallMode
#endif

[Files]
; Link-free: the launcher recreates the links in versions\ on first start.
Source: "{#Src}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
; Headless has none: a shortcut would start a second, desktop connector beside the task's.
Name: "{autoprograms}\{#Name}"; Filename: "{#Start}"; Parameters: """{app}\launcher.mjs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Check: not IsHeadless
Name: "{autodesktop}\{#Name}"; Filename: "{#Start}"; Parameters: """{app}\launcher.mjs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon; Check: not IsHeadless

[Registry]
; The same Run value Settings -> Start at login writes (packages/host/src/autostart.ts). Headless: the task instead.
#ifdef AlwaysStart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#Name}"; ValueData: """{#Start}"" ""{app}\launcher.mjs"" --background"; Flags: uninsdeletevalue; Check: not IsHeadless
#else
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#Name}"; ValueData: """{#Start}"" ""{app}\launcher.mjs"" --background"; Flags: uninsdeletevalue; Tasks: startatlogin
#endif

[Run]
Filename: "{#Start}"; Parameters: """{app}\launcher.mjs"""; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#Name}}"; Flags: nowait postinstall skipifsilent; Check: not IsHeadless

#ifdef Headless
[UninstallRun]
; Before the files go: end and delete the task, take back the batch logon right it granted (the
; uninstaller of an all-users install runs elevated). Step 7c adds unpairing.
Filename: "{#Start}"; Parameters: """{app}\headless-task.mjs"" remove"; WorkingDir: "{app}"; Flags: waituntilterminated runhidden; RunOnceId: "RemoveHeadlessTask"; Check: IsHeadless
#endif

[UninstallDelete]
; Updates, the launcher's junctions and logs; the data dir (%APPDATA%\{#AppId}) stays.
Type: filesandordirs; Name: "{app}\versions"
Type: filesandordirs; Name: "{app}\.update"
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\handoff"
Type: files; Name: "{app}\starting.html"
Type: files; Name: "{app}\headless"
Type: files; Name: "{app}\headless-account.json"

[Code]
#ifdef Headless
var
  HubPage: TInputQueryWizardPage;
  HeadlessError: Integer;

function CmdHeadless: Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/HEADLESS') = 0 then
      Result := True;
end;

{ Known before the wizard's task list exists: for all users (/ALLUSERS) it is always headless. }
function StartsHeadless: Boolean;
begin
  Result := IsAdminInstallMode;
end;

function IsHeadless: Boolean;
begin
  Result := IsAdminInstallMode;
end;

{ A headless install marks its folder with the account the task runs as: setup run again keeps to
  it. The folder is fixed (DisableDirPage), and the app constant can't be expanded this early. }
function Marker: String;
begin
  Result := ExpandConstant('{autopf}\{#Name}\headless');
end;

function WasHeadless: Boolean;
begin
  Result := IsAdminInstallMode and FileExists(Marker);
end;

function Me: String;
begin
  Result := GetEnv('USERDOMAIN') + '\' + GetUserNameString;
end;

{ .\name and a bare name are accounts on this computer, as headless-task.mjs reads them. }
function NormAccount(const Value: String): String;
begin
  Result := Trim(Value);
  if Copy(Result, 1, 2) = '.\' then
    Result := GetComputerNameString + '\' + Copy(Result, 3, Length(Result))
  else if (Result <> '') and (Pos('\', Result) = 0) and (Pos('@', Result) = 0) then
    Result := GetComputerNameString + '\' + Result;
end;

function MarkerAccount: String;
var
  S: AnsiString;
begin
  Result := '';
  if WasHeadless and LoadStringFromFile(Marker, S) then
    Result := Trim(String(S));
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  { An update run without /ALLUSERS would add a desktop connector beside the headless one. }
  if (CmdHeadless or FileExists(ExpandConstant('{commonpf}\{#Name}\headless'))) and
      not IsAdminInstallMode then begin
    Log('a headless install needs /ALLUSERS');
    SuppressibleMsgBox(CustomMessage('HeadlessNeedsAllUsers'), mbError, MB_OK, IDOK);
    Result := False;
  end else if IsAdminInstallMode and FileExists(ExpandConstant('{userpf}\{#Name}\unins000.exe')) then begin
    { A desktop connector beside it would start at sign-in on the same port, for the same hub. }
    Log('a desktop install is in ' + ExpandConstant('{userpf}\{#Name}'));
    SuppressibleMsgBox(CustomMessage('HeadlessDesktopInstalled'), mbError, MB_OK, IDOK);
    Result := False;
  end;
end;

procedure InitializeWizard;
begin
  HubPage := CreateInputQueryPage(wpSelectTasks, CustomMessage('HubPageCaption'),
    CustomMessage('HubPageDescription'), CustomMessage('HubPageNote'));
  HubPage.Add(CustomMessage('HubUrl'), False);
  HubPage.Add(CustomMessage('PairingCode'), False);
  HubPage.Add(CustomMessage('DeviceName'), False);
  HubPage.Add(CustomMessage('Account'), False);
  HubPage.Add(CustomMessage('Password'), True);
  HubPage.Values[0] := ExpandConstant('{param:HUBURL|}');
  HubPage.Values[1] := ExpandConstant('{param:PAIRINGCODE|}');
  HubPage.Values[2] := ExpandConstant('{param:NAME|}');
  { Run again, empty keeps the task's name; the connector names itself after the computer otherwise. }
  if (HubPage.Values[2] = '') and not WasHeadless then
    HubPage.Values[2] := GetComputerNameString;
  { The account it runs as: the one asked for, the task's, or this administrator. }
  HubPage.Values[3] := ExpandConstant('{param:ACCOUNT|}');
  if HubPage.Values[3] = '' then
    HubPage.Values[3] := MarkerAccount;
  if HubPage.Values[3] = '' then
    HubPage.Values[3] := Me;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = HubPage.ID) and not IsHeadless;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Account: String;
begin
  Result := True;
  { Per user, the headless choice says how to start setup for all users. }
  if (CurPageID = wpSelectTasks) and not IsAdminInstallMode and WizardIsTaskSelected('headless') then begin
    MsgBox(CustomMessage('HeadlessNeedsAllUsers'), mbInformation, MB_OK);
    Result := False;
  end;
  if (CurPageID <> HubPage.ID) or WizardSilent then
    exit;
  { A first headless install needs both; a later one may keep the task's. }
  if not WasHeadless and ((Trim(HubPage.Values[0]) = '') or (Trim(HubPage.Values[1]) = '')) then begin
    MsgBox(CustomMessage('HeadlessNeedsHub'), mbError, MB_OK);
    Result := False;
    exit;
  end;
  { Silent, headless-task.mjs says the same with its exit code. }
  Account := NormAccount(HubPage.Values[3]);
  if Copy(Account, Length(Account), 1) = '$' then begin
    MsgBox(FmtMessage(CustomMessage('HeadlessGmsa'), [Account]), mbError, MB_OK);
    Result := False;
  end else if (HubPage.Values[4] = '') and (CompareText(Account, NormAccount(Me)) <> 0) and
      (CompareText(Account, MarkerAccount) <> 0) then begin
    MsgBox(FmtMessage(CustomMessage('HeadlessNeedsPassword'), [Account]), mbError, MB_OK);
    Result := False;
  end;
end;

{ One argument for headless-task.mjs: quoted, with no quote or trailing backslash to break it. }
function Arg(const Flag, Value: String): String;
var
  V: String;
begin
  V := Trim(Value);
  StringChangeEx(V, '"', '', True);
  while (Length(V) > 0) and (V[Length(V)] = '\') do
    V := Copy(V, 1, Length(V) - 1);
  if V = '' then
    Result := ''
  else
    Result := ' ' + Flag + ' "' + V + '"';
end;

{ headless-task.mjs (setup is elevated for all users); its exit code, -1 if it didn't run. Only the
  command goes to the log: the arguments hold the pairing code. }
function RunTask(const Command, Params: String): Integer;
begin
  if not Exec(ExpandConstant('{#Start}'), '"' + ExpandConstant('{app}\headless-task.mjs') + '" ' +
      Command + Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Result) then begin
    Log('headless-task.mjs did not start: ' + SysErrorMessage(Result));
    Result := -1;
  end;
  Log('headless-task.mjs ' + Command + ': ' + IntToStr(Result));
end;

{ A running task holds node\nodew.exe open: stop it before the files are replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if WasHeadless and FileExists(ExpandConstant('{#Start}')) then
    RunTask('stop', '');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Account, Params, PasswordFile, Shown: String;
  Lines: TArrayOfString;
begin
  if (CurStep <> ssPostInstall) or not IsHeadless then
    exit;
  Account := NormAccount(HubPage.Values[3]);
  Params := Arg('--hub-url', HubPage.Values[0]) + Arg('--pairing-code', HubPage.Values[1]) +
    Arg('--name', HubPage.Values[2]) + Arg('--account', Account);
  { The password as a file, never on a command line; headless-task.mjs deletes it once read. }
  PasswordFile := ExpandConstant('{param:PASSWORDFILE|}');
  if HubPage.Values[4] <> '' then begin
    PasswordFile := ExpandConstant('{tmp}\account.pwd');
    SetArrayLength(Lines, 1);
    Lines[0] := HubPage.Values[4];
    SaveStringsToUTF8File(PasswordFile, Lines, False);
    HubPage.Values[4] := '';
  end;
  Params := Params + Arg('--password-file', PasswordFile);
  Code := RunTask('install', Params);
  if Code = 0 then begin
    SaveStringToFile(ExpandConstant('{app}\headless'), Account, False);
    exit;
  end;
  HeadlessError := 8;
  case Code of
    3: Shown := FmtMessage(CustomMessage('HeadlessBadLogon'), [Account, ExpandConstant('{app}')]);
    4: begin
         if Copy(Account, Length(Account), 1) = '$' then
           Shown := FmtMessage(CustomMessage('HeadlessGmsa'), [Account])
         else
           Shown := FmtMessage(CustomMessage('HeadlessNoAccount'), [Account]);
       end;
    5: Shown := FmtMessage(CustomMessage('HeadlessPasswordAgain'), [Account]);
    6: Shown := FmtMessage(CustomMessage('HeadlessBatchRefused'), [Account]);
  else
    Shown := FmtMessage(CustomMessage('HeadlessFailed'), [ExpandConstant('{app}')]);
  end;
  SuppressibleMsgBox(Shown, mbError, MB_OK, IDOK);
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := HeadlessError;
end;
#else
function StartsHeadless: Boolean;
begin
  Result := False;
end;

function IsHeadless: Boolean;
begin
  Result := False;
end;
#endif
