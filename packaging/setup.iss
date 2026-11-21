; Per-user Windows installer, no admin (ADR-0011), for the app or the connector (ADR-0014). Built by
; packaging/build.mjs: iscc /DVersion=4.1.0 /DSrc=<folder with node\ launcher.mjs product.json versions\>
; /DOutDir=<dir> /DOutName=<name> [/DName=<product name> /DAppId=<product id> /DAlwaysStart /DHeadless] setup.iss
; AlwaysStart: start at login without asking (the connector only helps while it runs).
; Headless (the connector, ADR-0024): a choice to start at boot with nobody signed in instead, as a
; scheduled task that headless-task.mjs registers elevated. Silent, for Server Core:
;   setup.exe /VERYSILENT /SUPPRESSMSGBOXES /HEADLESS /HUBURL=https://hub /PAIRINGCODE=AB12-CD34 [/NAME="Server"]
; Run again without /HUBURL and /PAIRINGCODE, it keeps the task's. Exit code 8: the task wasn't set up.
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
DefaultDirName={localappdata}\Programs\{#Name}
PrivilegesRequired=lowest
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
Headless=Start at boot with nobody signed in (headless), as this account
HubPageCaption=Pair with the hub
HubPageDescription=Make a pairing code in the hub's Settings → Hub management.
HubPageNote=The connector pairs when it first starts. Leave both empty to keep the address and code it has.
HubUrl=Hub address (for example https://maker.example.com):
PairingCode=Pairing code:
DeviceName=Name of this machine on the hub:
HeadlessNeedsHub=Enter the hub address and the pairing code.
HeadlessOtherUser=The connector runs as the account that installs it. Sign in as that administrator and run setup again, instead of elevating as another account.
HeadlessFailed={#Name} couldn't be set to start at boot. Run setup as an administrator, and see logs\headless-task.log in %1.
#endif

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Check: not StartsHeadless
#ifndef AlwaysStart
Name: startatlogin; Description: "{cm:StartAtLogin}"; Flags: unchecked
#endif
#ifdef Headless
Name: headless; Description: "{cm:Headless}"; GroupDescription: "{cm:HeadlessGroup}"; Flags: unchecked
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
; Before the files go: end and delete the task (elevated, as it was made). Step 7c adds unpairing.
Filename: "{#Start}"; Parameters: """{app}\headless-task.mjs"" remove"; WorkingDir: "{app}"; Flags: shellexec waituntilterminated runhidden; Verb: "runas"; RunOnceId: "RemoveHeadlessTask"; Check: IsHeadless
#endif

[UninstallDelete]
; Updates, the launcher's junctions and logs; the data dir (%APPDATA%\{#AppId}) stays.
Type: filesandordirs; Name: "{app}\versions"
Type: filesandordirs; Name: "{app}\.update"
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\starting.html"
Type: files; Name: "{app}\headless"

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

{ A headless install marks its folder: setup run again, or the uninstaller, keeps to it. The
  folder is fixed (DisableDirPage), and the app constant can't be expanded this early in the wizard. }
function WasHeadless: Boolean;
begin
  Result := FileExists(ExpandConstant('{localappdata}\Programs\{#Name}\headless'));
end;

{ Known before the wizard's task list exists. }
function StartsHeadless: Boolean;
begin
  Result := CmdHeadless or WasHeadless;
end;

function IsHeadless: Boolean;
begin
  Result := StartsHeadless or WizardIsTaskSelected('headless');
end;

procedure InitializeWizard;
begin
  HubPage := CreateInputQueryPage(wpSelectTasks, CustomMessage('HubPageCaption'),
    CustomMessage('HubPageDescription'), CustomMessage('HubPageNote'));
  HubPage.Add(CustomMessage('HubUrl'), False);
  HubPage.Add(CustomMessage('PairingCode'), False);
  HubPage.Add(CustomMessage('DeviceName'), False);
  HubPage.Values[0] := ExpandConstant('{param:HUBURL|}');
  HubPage.Values[1] := ExpandConstant('{param:PAIRINGCODE|}');
  HubPage.Values[2] := ExpandConstant('{param:NAME|}');
  { Run again, empty keeps the task's name; the connector names itself after the computer otherwise. }
  if (HubPage.Values[2] = '') and not WasHeadless then
    HubPage.Values[2] := GetComputerNameString;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpSelectTasks) and StartsHeadless then
    WizardSelectTasks('headless');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = HubPage.ID) and not IsHeadless;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  { A first headless install needs both; a later one may keep the task's. }
  if (CurPageID = HubPage.ID) and not WasHeadless and
     ((Trim(HubPage.Values[0]) = '') or (Trim(HubPage.Values[1]) = '')) then begin
    MsgBox(CustomMessage('HeadlessNeedsHub'), mbError, MB_OK);
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

{ headless-task.mjs, elevated (no prompt when setup already is); its exit code, -1 if it didn't run. }
function RunTask(const Params: String): Integer;
var
  Code: Integer;
  S: AnsiString;
  ResultFile: String;
begin
  Result := -1;
  ResultFile := ExpandConstant('{app}\logs\headless-task.result');
  DeleteFile(ResultFile);
  if not ShellExec('runas', ExpandConstant('{#Start}'),
      '"' + ExpandConstant('{app}\headless-task.mjs') + '" ' + Params,
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) then begin
    Log('headless-task.mjs did not start: ' + SysErrorMessage(Code));
    exit;
  end;
  if LoadStringFromFile(ResultFile, S) then
    Result := StrToIntDef(Trim(String(S)), -1);
  Log('headless-task.mjs ' + Params + ': ' + IntToStr(Result));
end;

{ A running task holds node\nodew.exe open: stop it before the files are replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if WasHeadless and FileExists(ExpandConstant('{#Start}')) then
    RunTask('stop');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
begin
  if (CurStep <> ssPostInstall) or not IsHeadless then
    exit;
  { What a desktop install left: its start at login and shortcuts would start a second connector. }
  RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#Name}');
  DeleteFile(ExpandConstant('{autoprograms}\{#Name}.lnk'));
  DeleteFile(ExpandConstant('{autodesktop}\{#Name}.lnk'));
  Code := RunTask('install' + Arg('--user', GetEnv('USERDOMAIN') + '\' + GetUserNameString) +
    Arg('--hub-url', HubPage.Values[0]) + Arg('--pairing-code', HubPage.Values[1]) +
    Arg('--name', HubPage.Values[2]));
  if Code = 0 then
    SaveStringToFile(ExpandConstant('{app}\headless'), '', False)
  else begin
    HeadlessError := 8;
    if Code = 2 then
      SuppressibleMsgBox(CustomMessage('HeadlessOtherUser'), mbError, MB_OK, IDOK)
    else
      SuppressibleMsgBox(FmtMessage(CustomMessage('HeadlessFailed'), [ExpandConstant('{app}')]),
        mbError, MB_OK, IDOK);
  end;
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
