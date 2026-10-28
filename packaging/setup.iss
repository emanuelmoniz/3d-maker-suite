; Per-user Windows installer, no admin (ADR-0011), for the app or the connector (ADR-0014). Built by
; packaging/build.mjs: iscc /DVersion=4.1.0 /DSrc=<folder with node\ launcher.mjs product.json versions\>
; /DOutDir=<dir> /DOutName=<name> [/DName=<product name> /DAppId=<product id> /DAlwaysStart] setup.iss
; AlwaysStart: start at login without asking (the connector only helps while it runs).
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
UninstallDisplayIcon={#Start}
OutputDir={#OutDir}
OutputBaseFilename={#OutName}
; The default (yes) also reaches the [Run] launcher, contrary to the docs: it then can't follow the
; junctions it makes in versions\ and the first start fails. Setup runs unelevated as the user who
; owns the install dir, so the guard protects nothing here.
RedirectionGuard=no

[CustomMessages]
StartAtLogin=Start {#Name} when I sign in

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
#ifndef AlwaysStart
Name: startatlogin; Description: "{cm:StartAtLogin}"; Flags: unchecked
#endif

[Files]
; Link-free: the launcher recreates the links in versions\ on first start.
Source: "{#Src}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#Name}"; Filename: "{#Start}"; Parameters: """{app}\launcher.mjs"""; WorkingDir: "{app}"
Name: "{autodesktop}\{#Name}"; Filename: "{#Start}"; Parameters: """{app}\launcher.mjs"""; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
; The same Run value Settings -> Start at login writes (packages/host/src/autostart.ts).
#ifdef AlwaysStart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#Name}"; ValueData: """{#Start}"" ""{app}\launcher.mjs"" --background"; Flags: uninsdeletevalue
#else
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#Name}"; ValueData: """{#Start}"" ""{app}\launcher.mjs"" --background"; Flags: uninsdeletevalue; Tasks: startatlogin
#endif

[Run]
Filename: "{#Start}"; Parameters: """{app}\launcher.mjs"""; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#Name}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Updates, the launcher's junctions and logs; the data dir (%APPDATA%\{#AppId}) stays.
Type: filesandordirs; Name: "{app}\versions"
Type: filesandordirs; Name: "{app}\.update"
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\starting.html"
