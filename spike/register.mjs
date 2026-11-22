// Throwaway spike, Plan 6.3.0 Step 5b: registers a task with a stored password the way
// headless-task.mjs would: the password goes to PowerShell on stdin, never on a command line.
//   node register.mjs <xmlFile> <taskName> <DOMAIN\user> <passwordFile>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [xml, name, user, pwFile] = process.argv.slice(2);
const password = readFileSync(pwFile, "utf8");
const script = [
  "$ErrorActionPreference = 'Stop'",
  // Base64 of UTF-8: stdin to powershell.exe is read in the OEM code page, which loses a ü.
  "$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))",
  "Register-ScheduledTask -TaskPath '\\' -TaskName $env:T_NAME -Xml (Get-Content -Raw -LiteralPath $env:T_XML) -User $env:T_USER -Password $p -Force | Out-Null",
].join("; ");
const t0 = Date.now();
try {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: `${Buffer.from(password, "utf8").toString("base64")}\n`,
    env: { ...process.env, T_NAME: name, T_XML: xml, T_USER: user },
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log(`ok in ${Date.now() - t0} ms`);
} catch (e) {
  const err = String(e.stderr ?? e.message).trim();
  console.log(`FAILED exit=${e.status} leaksPassword=${err.includes(password)} ${err.split("\n").slice(0, 4).join(" | ")}`);
  process.exit(1);
}
