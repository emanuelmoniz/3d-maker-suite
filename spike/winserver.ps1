# Throwaway spike, Plan 6.3.0 Step 3b: what keeps the connector running on Windows Server with
# nobody signed in. One variant per run:
#   task-s4u   Task Scheduler, at startup, as the installing user, no stored password (S4U)
#   task-pwd   Task Scheduler, at startup, as a named account with its password
#   winsw      a Windows service through WinSW 2.12.0, as a named account
#   nssm       a Windows service through NSSM 2.24, as a named account
# pwsh spike/winserver.ps1 -Variant task-s4u -Install C:\cmc -Hub http://127.0.0.1:4310
param(
  [Parameter(Mandatory)][string]$Variant,
  [string]$Install = 'C:\cmc',
  [string]$Hub = 'http://127.0.0.1:4310',
  [string]$Account = 'cmsvc',
  [string]$Password = 'Spike-Pass-2026!x'
)
$ErrorActionPreference = 'Stop'
$Conn = 'http://127.0.0.1:4301'
$TaskName = '3D Maker Suite Connector'
$Svc = '3d-maker-suite-connector'
$Device = "ci-$Variant"
$out = [ordered]@{ variant = $Variant; os = (Get-CimInstance Win32_OperatingSystem).Caption; build = [Environment]::OSVersion.Version.ToString() }
function Note($k, $v) { $out[$k] = "$v"; Write-Host "[$Variant] $k = $v" }
function Up { try { (Invoke-WebRequest "$Conn/api/health" -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
function WaitFor([scriptblock]$cond, [int]$sec) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $sec) { if (& $cond) { return [math]::Round($sw.Elapsed.TotalSeconds, 1) }; Start-Sleep -Milliseconds 500 }
  return $null
}
function Procs { @(Get-CimInstance Win32_Process -Filter "Name='nodew.exe'" | Where-Object { $_.ExecutablePath -like "$Install\*" }) }
function Launcher { Procs | Where-Object { $_.CommandLine -like '*launcher.mjs*' } | Select-Object -First 1 }
function Program { Procs | Where-Object { $_.CommandLine -like '*src/main.ts*' } | Select-Object -First 1 }
function Who($p) {
  if (-not $p) { return 'none' }
  $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  $prio = try { (Get-Process -Id $p.ProcessId).PriorityClass } catch { '?' }
  "$($o.Domain)\$($o.User) session=$($p.SessionId) pid=$($p.ProcessId) priority=$prio"
}
$isTask = $Variant -like 'task*'
function State {
  if ($isTask) { $i = Get-ScheduledTaskInfo -TaskName $TaskName; "$((Get-ScheduledTask -TaskName $TaskName).State) lastResult=0x$('{0:X}' -f $i.LastTaskResult)" }
  else { "$((Get-Service $Svc).Status)" }
}
function StartIt { if ($isTask) { Start-ScheduledTask -TaskName $TaskName } else { Start-Service $Svc } }
function StopIt { if ($isTask) { Stop-ScheduledTask -TaskName $TaskName } else { Stop-Service $Svc -Force } }
function Post($path) { try { Invoke-WebRequest "$Conn$path" -Method Post -Headers @{ Origin = $Conn } -TimeoutSec 5 | Out-Null } catch { Write-Host "POST $path : $_" } }
function KillAll { Procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
function Reset { KillAll; Start-Sleep 2; try { StopIt } catch {}; KillAll; Start-Sleep 1; StartIt; [void](WaitFor { Up } 90) }

# The hub: an admin session, a headless code, the device list.
$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$admin = @{ email = 'admin@example.com'; password = 'pair-test-password' }
try { Invoke-RestMethod "$Hub/api/auth/setup" -Method Post -WebSession $web -ContentType application/json -Body (@{ email = $admin.email; displayName = 'Spike'; password = $admin.password } | ConvertTo-Json) | Out-Null }
catch { Invoke-RestMethod "$Hub/api/auth/login" -Method Post -WebSession $web -ContentType application/json -Body ($admin | ConvertTo-Json) | Out-Null }
Invoke-RestMethod "$Hub/api/preferences" -Method Patch -WebSession $web -ContentType application/json -Body '{"hubEnabled":true}' | Out-Null
$me = (Invoke-RestMethod "$Hub/api/auth/me" -WebSession $web).user
$code = (Invoke-RestMethod "$Hub/api/hub/pairing-codes" -Method Post -WebSession $web -ContentType application/json -Body (@{ userId = $me.id; kind = 'headless' } | ConvertTo-Json)).code
function Mine { $all = Invoke-RestMethod "$Hub/api/hub/devices" -WebSession $web; $all | Where-Object { $_.name -eq $Device } | Select-Object -First 1 }

# Register.
$node = "$Install\node\nodew.exe"
try {
$launcherArgs = "`"$Install\launcher.mjs`" --background --headless --hub-url $Hub --pairing-code $code --name $Device"
$user = if ($Variant -eq 'task-s4u') { "$env:USERDOMAIN\$env:USERNAME" } else { "$env:COMPUTERNAME\$Account" }
Note 'runsAs' $user
$sw = [Diagnostics.Stopwatch]::StartNew()
switch ($Variant) {
  { $_ -like 'task*' } {
    $a = New-ScheduledTaskAction -Execute $node -Argument $launcherArgs -WorkingDirectory $Install
    $t = New-ScheduledTaskTrigger -AtStartup
    $s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -Priority 5
    if ($Variant -eq 'task-s4u') {
      $p = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
      Register-ScheduledTask -TaskName $TaskName -Action $a -Trigger $t -Principal $p -Settings $s | Out-Null
    } else {
      Register-ScheduledTask -TaskName $TaskName -Action $a -Trigger $t -Settings $s -User $user -Password $Password -RunLevel Limited | Out-Null
    }
    $x = [xml](Export-ScheduledTask -TaskName $TaskName)
    Note 'taskDefaults' "priority=$($x.Task.Settings.Priority) logon=$($x.Task.Principals.Principal.LogonType)"
  }
  'winsw' {
    Copy-Item "$env:RUNNER_TEMP\WinSW-net461.exe" "$Install\connector-service.exe"
    @"
<service>
  <id>$Svc</id>
  <name>3D Maker Suite Connector</name>
  <description>Spike</description>
  <executable>$node</executable>
  <arguments>$([Security.SecurityElement]::Escape($launcherArgs))</arguments>
  <workingdirectory>$Install</workingdirectory>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="10 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <log mode="roll"/>
  <serviceaccount>
    <domain>$env:COMPUTERNAME</domain><user>$Account</user><password>$Password</password>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>
</service>
"@ | Set-Content "$Install\connector-service.xml" -Encoding utf8
    & "$Install\connector-service.exe" install
    if ($LASTEXITCODE) { throw "winsw install: $LASTEXITCODE" }
  }
  'nssm' {
    $n = "$env:RUNNER_TEMP\nssm.exe"
    & $n install $Svc $node | Out-Null
    & $n set $Svc AppParameters $launcherArgs.Replace("`"$Install\launcher.mjs`"", "$Install\launcher.mjs") | Out-Null
    & $n set $Svc AppDirectory $Install | Out-Null
    & $n set $Svc ObjectName "$env:COMPUTERNAME\$Account" $Password | Out-Null
    & $n set $Svc AppExit Default Restart | Out-Null
    & $n set $Svc AppExit 0 Exit | Out-Null
    & $n set $Svc AppRestartDelay 5000 | Out-Null
    & $n set $Svc Start SERVICE_AUTO_START | Out-Null
    sc.exe failure $Svc reset= 3600 actions= restart/10000/restart/10000/restart/10000 | Out-Null
  }
}
Note 'register' "ok in $([math]::Round($sw.Elapsed.TotalSeconds,1)) s"

# 1. Start with nobody signed in as that user (the scheduler or the SCM starts it, session 0).
StartIt
$t = WaitFor { Up } 90
Note 'start' $(if ($t) { "up in $t s" } else { "NOT UP in 90 s, state=$(State)" })
if (-not $t) { throw 'not up' }
Note 'launcher' (Who (Launcher))
Note 'program' (Who (Program))
$paired = WaitFor { (Mine).online } 60
Note 'paired' $(if ($paired) { "online on the hub in $paired s, install=$((Mine).install)" } else { 'NOT online on the hub' })
$keys = @(Get-ChildItem -Path 'C:\Users\*\AppData\Roaming\3d-maker-suite-connector\secret.key', 'C:\Windows\System32\config\systemprofile\AppData\Roaming\3d-maker-suite-connector\secret.key', 'C:\Windows\ServiceProfiles\*\AppData\Roaming\3d-maker-suite-connector\secret.key' -ErrorAction SilentlyContinue)
Note 'dataDir' (($keys | ForEach-Object { "$($_.DirectoryName) owner=$((Get-Acl $_.FullName).Owner)" }) -join ' | ')
Note 'logOwner' "$((Get-Acl "$Install\logs\launcher.log").Owner)"

# 2. Self-update path: the program exits 75, the launcher starts it again; the supervisor must not see it.
$l1 = (Launcher).ProcessId; $p1 = (Program).ProcessId
Post '/restart'
$down = WaitFor { -not (Up) } 20; $back = WaitFor { Up } 60
Note 'restart75' "down=$down back=$back launcherSame=$((Launcher).ProcessId -eq $l1) programNew=$((Program).ProcessId -ne $p1) state=$(State)"

# 3. The program killed: the launcher exits 1 (Windows has no signals), does the supervisor start it again?
$l1 = (Launcher).ProcessId
Stop-Process -Id (Program).ProcessId -Force
$down = WaitFor { -not (Up) } 20
Start-Sleep 2; Note 'afterProgramKill' "launcherAlive=$([bool](Get-Process -Id $l1 -ErrorAction SilentlyContinue)) state=$(State)"
$back = WaitFor { Up } 150
Note 'killProgram' $(if ($back) { "back in $back s, launcher $(if ((Launcher).ProcessId -ne $l1) {'new'} else {'same'}), state=$(State)" } else { "NOT BACK in 150 s, state=$(State)" })
if (-not $back) { Reset }

# 4. The launcher killed: does its program outlive it, does the supervisor start a new launcher?
$l1 = (Launcher).ProcessId; $p1 = (Program).ProcessId
Stop-Process -Id $l1 -Force
Start-Sleep 3
Note 'afterLauncherKill' "programAlive=$([bool](Get-Process -Id $p1 -ErrorAction SilentlyContinue)) healthUp=$(Up) state=$(State)"
$newL = WaitFor { $l = Launcher; $l -and $l.ProcessId -ne $l1 } 150
Start-Sleep 5
Note 'killLauncher' "newLauncher=$(if ($newL) {"after $newL s"} else {'none in 150 s'}) launcherNow=$([bool](Launcher)) programNow=$((Program).ProcessId) (old $p1) healthUp=$(Up) state=$(State)"
Reset
Note 'afterReset' "up=$(Up) state=$(State)"

# 5. Stop connector on the page (exit 0): must stay down.
Post '/stop'
$down = WaitFor { -not (Up) } 20
Start-Sleep 90
Note 'stopConnector' "down=$down after90s up=$(Up) procs=$((Procs).Count) state=$(State)"

# 6. The supervisor's own stop and start: does stop end the program too (no orphan)?
StartIt; $t = WaitFor { Up } 90
StopIt
$down = WaitFor { -not (Up) } 30
Start-Sleep 3
Note 'supervisorStop' "start=$t down=$down nodeLeft=$((Procs).Count) state=$(State)"
} catch {
  Note 'error' "$_ at line $($_.InvocationInfo.ScriptLineNumber)"
} finally {
  try { StopIt } catch {}
  KillAll
  # The launcher's own log, the wrapper's, the scheduler's history.
  Get-Content "$Install\logs\launcher.log" -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  launcher.log: $_" }
  Get-Content "$Install\logs\server.log" -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  server.log: $_" }
  Get-ChildItem "$Install\connector-service*.log" -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_ -Tail 25 | ForEach-Object { Write-Host "  $($_.PSChildName): $_" } }
  if ($isTask) {
    Get-WinEvent -LogName Microsoft-Windows-TaskScheduler/Operational -MaxEvents 40 -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -like "*$TaskName*" } | Sort-Object TimeCreated |
      ForEach-Object { Write-Host "  sched $($_.TimeCreated.ToString('HH:mm:ss')) $($_.Id): $(($_.Message -split "`n")[0])" }
  } else {
    Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager' } -MaxEvents 30 -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -like '*3D Maker Suite*' } | Sort-Object TimeCreated |
      ForEach-Object { Write-Host "  scm $($_.TimeCreated.ToString('HH:mm:ss')) $($_.Id): $(($_.Message -split "`n")[0])" }
  }
  # Clean up for the next variant.
  try {
    if ($isTask) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    elseif ($Variant -eq 'winsw') { & "$Install\connector-service.exe" uninstall | Out-Null; Remove-Item "$Install\connector-service.*" -Force }
    else { & "$env:RUNNER_TEMP\nssm.exe" remove $Svc confirm | Out-Null }
  } catch { Write-Host "cleanup: $_" }
  KillAll
}
$keys = @(Get-ChildItem -Path 'C:\Users\*\AppData\Roaming\3d-maker-suite-connector', 'C:\Windows\System32\config\systemprofile\AppData\Roaming\3d-maker-suite-connector' -ErrorAction SilentlyContinue)
$keys | ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item "$Install\logs" -Recurse -Force -ErrorAction SilentlyContinue
$out | ConvertTo-Json | Set-Content "$env:RUNNER_TEMP\spike-$Variant.json"
"### $Variant`n" + (($out.GetEnumerator() | ForEach-Object { "- **$($_.Key)**: $($_.Value)" }) -join "`n") + "`n" | Add-Content $env:GITHUB_STEP_SUMMARY
