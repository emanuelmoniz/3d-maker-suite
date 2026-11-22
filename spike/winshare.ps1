# Throwaway spike, Plan 6.3.0 Step 5b (S9): a headless connector on Windows Server as a named account
# with a stored password, for SMB shares. Runs after the workflow installed it headless (S4U) and it
# paired. Measures: the batch logon right (LSA vs secedit), a Password task run from the admin's
# profile, a UNC share as S4U and as the account (read, write, events), Machine env, the connector
# itself as the account with its data copied over, a root on the share, a wrong and a changed password.
param([string]$Hub = 'http://127.0.0.1:4310', [string]$Dir = "$env:LOCALAPPDATA\Programs\3D Maker Suite Connector")
$ErrorActionPreference = 'Stop'
$Task = '3D Maker Suite Connector'
$Conn = 'http://127.0.0.1:4301'
$dir = $Dir
$node = "$dir\node\nodew.exe"
$me = "$env:USERDOMAIN\$env:USERNAME"
$unc = '\\localhost\ci'
$probe = 'C:\probe'
$out = [ordered]@{ os = (Get-CimInstance Win32_OperatingSystem).Caption; build = [Environment]::OSVersion.Version.ToString(); me = $me }
function Note($k, $v) { $out[$k] = "$v"; Write-Host "$k = $v" }
function Up { try { (Invoke-WebRequest "$Conn/api/health" -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
function WaitFor([scriptblock]$cond, [int]$sec) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $sec) { if (& $cond) { return [math]::Round($sw.Elapsed.TotalSeconds, 1) }; Start-Sleep -Milliseconds 500 }
  return $null
}
function Info($name) { $i = Get-ScheduledTaskInfo -TaskPath '\' -TaskName $name; "state=$((Get-ScheduledTask -TaskPath '\' -TaskName $name).State) lastResult=0x$('{0:X8}' -f $i.LastTaskResult)" }
function Owner($p) { if (-not $p) { return 'none' }; $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner; "$($o.Domain)\$($o.User)" }
function Procs { @(Get-CimInstance Win32_Process -Filter "Name='nodew.exe'" | Where-Object { $_.ExecutablePath -like "$dir\*" }) }
function BatchLine { secedit /export /cfg "$env:RUNNER_TEMP\r.inf" /areas USER_RIGHTS /quiet | Out-Null; (Get-Content "$env:RUNNER_TEMP\r.inf" | Where-Object { $_ -like 'SeBatchLogonRight*' }) }
function NewPw { (-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 16 | ForEach-Object { [char]$_ })) + ' "q''$x ü!' }

try {
  $sw = [Diagnostics.Stopwatch]::StartNew(); . "$PSScriptRoot\lsa.ps1"; Note 'lsaAddType' "$([math]::Round($sw.Elapsed.TotalSeconds, 1)) s"

  # The hub: an admin session, the paired device.
  $web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-RestMethod "$Hub/api/auth/login" -Method Post -WebSession $web -ContentType application/json -Body (@{ email = 'admin@example.com'; password = 'pair-test-password' } | ConvertTo-Json) | Out-Null
  function Mine { Invoke-RestMethod "$Hub/api/hub/devices" -WebSession $web | Where-Object { $_.name -eq 'ci-headless' } | Select-Object -First 1 }
  $device = Mine
  Note 'deviceS4U' "id=$($device.id) online=$($device.online) install=$($device.install)"

  # Accounts (no password on a command line: New-LocalUser), a share on this machine.
  New-Item -ItemType Directory -Force $probe | Out-Null
  icacls $probe /grant '*S-1-1-0:(OI)(CI)M' | Out-Null
  Copy-Item "$PSScriptRoot\probe.mjs" $probe
  $pw = NewPw
  New-LocalUser ciconn -Password (ConvertTo-SecureString $pw -AsPlainText -Force) -PasswordNeverExpires -AccountNeverExpires | Out-Null
  New-LocalUser cisec -Password (ConvertTo-SecureString (NewPw) -AsPlainText -Force) -PasswordNeverExpires | Out-Null
  $acct = "$env:COMPUTERNAME\ciconn"
  $sid = (Get-LocalUser ciconn).SID.Value
  $sidSec = (Get-LocalUser cisec).SID.Value
  [IO.File]::WriteAllText("$env:RUNNER_TEMP\pw.txt", $pw)
  [IO.File]::WriteAllText("$env:RUNNER_TEMP\wrong.txt", "wrong-$pw")
  New-Item -ItemType Directory -Force C:\cishare\Benchy | Out-Null
  'seed' | Set-Content C:\cishare\Benchy\seed.txt
  icacls C:\cishare /grant 'ciconn:(OI)(CI)M' | Out-Null
  New-SmbShare -Name ci -Path C:\cishare -FullAccess $acct, $me | Out-Null
  Note 'shareAsAdmin' ((Get-ChildItem $unc).Name -join ',')

  # A probe task: who it is, its profile, what it can do on the share.
  function Probe($tag, $user, $logon, $pwFile, $handoff, [int]$wait = 60) {
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Principals><Principal id="Author"><UserId>$user</UserId><LogonType>$logon</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>5</Priority></Settings>
  <Actions Context="Author"><Exec><Command>$node</Command><Arguments>"$probe\probe.mjs" $tag $unc $probe "$handoff"</Arguments><WorkingDirectory>$probe</WorkingDirectory></Exec></Actions>
</Task>
"@
    $f = "$probe\$tag.xml"; $xml | Set-Content $f -Encoding Unicode
    $name = "probe-$tag"
    if ($logon -eq 'S4U') { Register-ScheduledTask -TaskPath '\' -TaskName $name -Xml (Get-Content -Raw $f) -Force | Out-Null }
    else { $r = node "$PSScriptRoot\register.mjs" $f $name $user $pwFile; Note "register-$tag" $r; if ($LASTEXITCODE) { return } }
    Start-ScheduledTask -TaskPath '\' -TaskName $name
    $ready = WaitFor { Test-Path "$probe\$tag.ready" } $wait
    if (-not $ready) { Note "probe-$tag" "NOT READY in $wait s, $(Info $name)"; Unregister-ScheduledTask -TaskName $name -Confirm:$false; return }
    "local $tag" | Set-Content "C:\cishare\local-$tag.txt"
    "admin $tag" | Set-Content "$unc\unc-admin-$tag.txt"
    [void](WaitFor { Test-Path "$probe\$tag.json" } 40)
    $j = Get-Content "$probe\$tag.json" -Raw -ErrorAction SilentlyContinue
    Note "probe-$tag" $(if ($j) { ($j | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 4) } else { "no result, $(Info $name)" })
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }

  # 1. S4U as the admin (today's task): the share without network credentials.
  [Environment]::SetEnvironmentVariable('APP_DOWNLOAD_URL', 'http://spike-user', 'User')
  Probe 's4u' $me 'S4U'

  # 2. The named account before any right.
  Note 'rightsBefore' "lsa=[$([SpikeLsa]::Get($sid) -join ',')] batchLine=$(BatchLine)"
  Probe 'noright' $acct 'Password' "$env:RUNNER_TEMP\pw.txt" '' 20

  # 3. The batch logon right: LSA for ciconn, secedit for cisec (does it rewrite anything else?).
  $sw = [Diagnostics.Stopwatch]::StartNew(); [SpikeLsa]::Add($sid, 'SeBatchLogonRight')
  Note 'lsaAdd' "$([math]::Round($sw.Elapsed.TotalMilliseconds)) ms, lsa=[$([SpikeLsa]::Get($sid) -join ',')], export=$(BatchLine)"
  [SpikeLsa]::Add($sid, 'SeBatchLogonRight'); Note 'lsaAddTwice' 'no error'
  secedit /export /cfg "$env:RUNNER_TEMP\before.inf" /areas USER_RIGHTS /quiet | Out-Null
  $inf = Get-Content "$env:RUNNER_TEMP\before.inf" | ForEach-Object { if ($_ -like 'SeBatchLogonRight*') { "$_,*$sidSec" } else { $_ } }
  $inf | Set-Content "$env:RUNNER_TEMP\edit.inf" -Encoding Unicode
  $sw = [Diagnostics.Stopwatch]::StartNew()
  secedit /configure /db "$env:RUNNER_TEMP\edit.sdb" /cfg "$env:RUNNER_TEMP\edit.inf" /areas USER_RIGHTS /quiet | Out-Null
  $code = $LASTEXITCODE
  secedit /export /cfg "$env:RUNNER_TEMP\after.inf" /areas USER_RIGHTS /quiet | Out-Null
  $diff = Compare-Object (Get-Content "$env:RUNNER_TEMP\before.inf") (Get-Content "$env:RUNNER_TEMP\after.inf") | ForEach-Object { "$($_.SideIndicator) $(($_.InputObject -split '=')[0].Trim())" }
  Note 'secedit' "exit=$code $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s, cisecRight=$([SpikeLsa]::Get($sidSec) -join ','), changedLines=[$($diff -join '; ')]"

  # 4. As the account, from the admin's profile: without and with Modify on the install folder.
  Probe 'nogrant' $acct 'Password' "$env:RUNNER_TEMP\pw.txt" '' 20
  $g = icacls $dir /grant 'ciconn:(OI)(CI)M' /T /C /Q 2>&1; Note 'icaclsGrant' (($g | Select-Object -Last 3) -join ' | ')
  New-Item -ItemType Directory -Force "$dir\handoff" | Out-Null
  icacls "$dir\handoff" /inheritance:r /grant:r 'ciconn:(OI)(CI)M' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' /Q | Out-Null
  'handed over' | Set-Content "$dir\handoff\state.json"
  Note 'handoffFileAcl' (((Get-Acl "$dir\handoff\state.json").Access | ForEach-Object { "$($_.IdentityReference):$($_.FileSystemRights)" }) -join '; ')
  Note 'elevated' ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  [Environment]::SetEnvironmentVariable('APP_DOWNLOAD_URL', 'http://spike-machine', 'Machine')
  Probe 'pwd' $acct 'Password' "$env:RUNNER_TEMP\pw.txt" "$dir\handoff\state.json"
  Note 'profile' "C:\Users\ciconn exists=$(Test-Path C:\Users\ciconn)"
  Note 'handoffAcl' (((Get-Acl "$dir\handoff").Access | ForEach-Object { "$($_.IdentityReference):$($_.FileSystemRights)" }) -join '; ')
  try { Remove-Item "$dir\handoff" -Recurse -Force } catch { Note 'handoffRemove' "ERR $_" }

  # 5. A wrong password at registration.
  Probe 'wrong' $acct 'Password' "$env:RUNNER_TEMP\wrong.txt" '' 10

  # 6. The connector itself as the account, its data copied into the account's profile.
  $before = Mine
  Stop-ScheduledTask -TaskPath '\' -TaskName $Task
  [void](WaitFor { -not (Up) } 30)
  $x = (Export-ScheduledTask -TaskPath '\' -TaskName $Task) -replace '<LogonType>S4U</LogonType>', '<LogonType>Password</LogonType>' -replace '<UserId>[^<]*</UserId>', "<UserId>$acct</UserId>"
  $x | Set-Content "$probe\task.xml" -Encoding Unicode
  $data = "$env:APPDATA\3d-maker-suite-connector"
  Copy-Item $data 'C:\Users\ciconn\AppData\Roaming\' -Recurse -Force
  Note 'copiedData' ((Get-ChildItem 'C:\Users\ciconn\AppData\Roaming\3d-maker-suite-connector').Name -join ',')
  Note 'registerConnector' (node "$PSScriptRoot\register.mjs" "$probe\task.xml" $Task $acct "$env:RUNNER_TEMP\pw.txt")
  $px = [xml](Export-ScheduledTask -TaskPath '\' -TaskName $Task)
  Note 'connectorPrincipal' "$($px.Task.Principals.Principal.UserId) $($px.Task.Principals.Principal.LogonType) $($px.Task.Principals.Principal.RunLevel)"
  Start-ScheduledTask -TaskPath '\' -TaskName $Task
  $t = WaitFor { Up } 90
  Note 'connectorStart' $(if ($t) { "up in $t s" } else { "NOT UP, $(Info $Task)" })
  if (-not $t) {
    Note 'logAcl' (((Get-Acl "$dir\logs\launcher.log").Access | ForEach-Object { "$($_.IdentityReference):$($_.FileSystemRights)" }) -join '; ')
    $args0 = ([xml](Export-ScheduledTask -TaskPath '\' -TaskName $Task)).Task.Actions.Exec.Arguments
    $diag = (Get-Content "$probe\task.xml" -Raw) -replace '<Command>[^<]*</Command>', '<Command>cmd.exe</Command>' -replace '<Arguments>[^<]*</Arguments>', ('<Arguments>' + [Security.SecurityElement]::Escape("/c `"`"$node`" $args0 > C:\probe\launcher.out 2>&1`"") + '</Arguments>')
    $diag | Set-Content "$probe\diag.xml" -Encoding Unicode
    Note 'registerDiag' (node "$PSScriptRoot\register.mjs" "$probe\diag.xml" 'diag' $acct "$env:RUNNER_TEMP\pw.txt")
    Start-ScheduledTask -TaskPath '\' -TaskName 'diag'; Start-Sleep 20
    Note 'diag' "$(Info 'diag') out=$((Get-Content C:\probe\launcher.out -Raw -ErrorAction SilentlyContinue) -replace '\s+', ' ')"
    Stop-ScheduledTask -TaskPath '\' -TaskName 'diag'
  }
  Note 'connectorOwners' ((Procs | ForEach-Object { "$(Owner $_) $(if ($_.CommandLine -like '*launcher.mjs*') {'launcher'} else {'program'})" }) -join '; ')
  $on = WaitFor { $d = Mine; $d.online -and $d.id -eq $before.id } 60
  Note 'sameDevice' $(if ($on) { "online, same id, in $on s" } else { "NOT: $((Mine) | ConvertTo-Json -Compress)" })
  Note 'logWrite' "launcher.log last=$((Get-Content "$dir\logs\launcher.log" -Tail 1))"

  # 7. A root on the share: the connector indexes \\localhost\ci.
  try {
    Invoke-RestMethod "$Hub/api/hub/devices/$($before.id)/folders" -Method Post -WebSession $web -ContentType application/json -Body (@{ path = $unc } | ConvertTo-Json) | Out-Null
    $root = Invoke-RestMethod "$Hub/api/roots" -Method Post -WebSession $web -ContentType application/json -Body (@{ path = $unc; location = $before.id } | ConvertTo-Json)
    $ok = WaitFor { $r = Invoke-RestMethod "$Hub/api/roots" -WebSession $web | Where-Object { $_.id -eq $root.id }; $r.state -eq 'ok' -and $r.mount } 60
    $r = Invoke-RestMethod "$Hub/api/roots" -WebSession $web | Where-Object { $_.id -eq $root.id }
    Note 'rootOnShare' "after=$ok state=$($r.state) mount=$($r.mount | ConvertTo-Json -Compress)"
  } catch { Note 'rootOnShare' "ERR $_" }

  # 8. The account's password changed: the task can't start; setup with the new one again.
  Set-LocalUser ciconn -Password (ConvertTo-SecureString "new-$pw" -AsPlainText -Force)
  Stop-ScheduledTask -TaskPath '\' -TaskName $Task
  [void](WaitFor { -not (Up) } 30)
  Start-ScheduledTask -TaskPath '\' -TaskName $Task
  Start-Sleep 20
  $off = WaitFor { -not (Mine).online } 90
  Note 'passwordChanged' "up=$(Up) $(Info $Task) hubOffline=$off"
  [IO.File]::WriteAllText("$env:RUNNER_TEMP\pw.txt", "new-$pw")
  Note 'reRegister' (node "$PSScriptRoot\register.mjs" "$probe\task.xml" $Task $acct "$env:RUNNER_TEMP\pw.txt")
  Start-ScheduledTask -TaskPath '\' -TaskName $Task
  $t = WaitFor { Up } 90
  Note 'afterNewPassword' "up=$t $(Info $Task) online=$(WaitFor { (Mine).online } 60)"

  # 9. Revoking the right.
  [SpikeLsa]::Remove($sid, 'SeBatchLogonRight')
  Note 'lsaRemove' "lsa=[$([SpikeLsa]::Get($sid) -join ',')], export=$(BatchLine)"
} catch {
  Note 'error' "$_ at line $($_.InvocationInfo.ScriptLineNumber)"
} finally {
  Get-Content "$dir\logs\launcher.log" -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  launcher.log: $_" }
  Get-WinEvent -LogName Microsoft-Windows-TaskScheduler/Operational -MaxEvents 80 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -like "*$Task*" -or $_.Message -like '*probe-*' } | Sort-Object TimeCreated |
    ForEach-Object { Write-Host "  sched $($_.TimeCreated.ToString('HH:mm:ss')) $($_.Id): $(($_.Message -split "`n")[0])" }
}
$out | ConvertTo-Json | Set-Content "$env:RUNNER_TEMP\spike-winshare.json"
"### $($out.os) $($out.build)`n" + (($out.GetEnumerator() | ForEach-Object { "- **$($_.Key)**: ``$($_.Value)``" }) -join "`n") + "`n" | Add-Content $env:GITHUB_STEP_SUMMARY
