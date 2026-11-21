// A headless connector on Windows (ADR-0024, Plan 6.3.0 Step 3b): the scheduled task that starts it
// at boot with nobody signed in, as the installing user without a stored password (S4U). The
// installer runs it elevated with the bundled Node, from the install dir:
//   nodew.exe headless-task.mjs install --user DOMAIN\name [--hub-url U --pairing-code C] [--name N]
//     registers the task and starts it; without an address and code it keeps the ones the task has
//   nodew.exe headless-task.mjs stop     ends a running task and waits for it (the installer, before files)
//   nodew.exe headless-task.mjs remove   ends and deletes it (the uninstaller)
// The task's own restart on failure doesn't react to an exit code (the spike), so the launcher
// starts a crashed program again itself. Exit 0 ok, 1 failed, 2 not the installing user; the reason
// goes to logs/headless-task.log. Node stdlib only; ships with the connector's installer.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { product } from "./launcher.mjs";

/** One argument for a Windows command line (CommandLineToArgvW rules). */
export function quoteArg(s) {
  if (s !== "" && !/[\s"]/.test(s)) return s;
  let out = '"';
  let slashes = 0;
  for (const c of s) {
    if (c === "\\") {
      slashes++;
      continue;
    }
    out += c === '"' ? `${"\\".repeat(slashes * 2 + 1)}"` : `${"\\".repeat(slashes)}${c}`;
    slashes = 0;
  }
  return `${out}${"\\".repeat(slashes * 2)}"`;
}

/** The reverse of quoteArg over a whole command line. */
export function splitArgs(line) {
  const args = [];
  let cur = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    if (c === "\\") {
      let n = 0;
      while (line[i] === "\\") {
        n++;
        i++;
      }
      if (line[i] === '"') {
        cur += "\\".repeat(Math.floor(n / 2));
        if (n % 2) {
          cur += '"';
          i++;
        }
      } else cur += "\\".repeat(n);
      started = true;
    } else if (c === '"') {
      quoted = !quoted;
      started = true;
      i++;
    } else if (/\s/.test(c) && !quoted) {
      if (started) args.push(cur);
      cur = "";
      started = false;
      i++;
    } else {
      cur += c;
      started = true;
      i++;
    }
  }
  if (started) args.push(cur);
  return args;
}

const escapeXml = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const unescapeXml = (s) =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/** What the launcher gets: always --background --headless, then the pairing the task carries. */
export function launcherArgs(launcher, pair = {}) {
  return [
    launcher,
    "--background",
    "--headless",
    ...(pair.hubUrl ? ["--hub-url", pair.hubUrl] : []),
    ...(pair.code ? ["--pairing-code", pair.code] : []),
    ...(pair.name ? ["--name", pair.name] : []),
  ]
    .map(quoteArg)
    .join(" ");
}

/**
 * The task: at boot, as `user` with no stored password (S4U, no elevation), one instance, no time
 * limit (the default of 72 hours would end it), priority 5 (the default 7 runs it below normal).
 */
export function taskXml({ user, node, launcher, dir, pair, description }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${escapeXml(description)}</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(user)}</UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(node)}</Command>
      <Arguments>${escapeXml(launcherArgs(launcher, pair))}</Arguments>
      <WorkingDirectory>${escapeXml(dir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** The hub address, code and name an existing task passes (from `schtasks /Query /XML`). */
export function pairFromXml(xml) {
  const m = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(xml);
  if (!m) return {};
  const { values } = parseArgs({
    args: splitArgs(unescapeXml(m[1])),
    options: {
      "hub-url": { type: "string" },
      "pairing-code": { type: "string" },
      name: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });
  const str = (v) => (typeof v === "string" && v ? v : undefined);
  return Object.fromEntries(
    Object.entries({
      hubUrl: str(values["hub-url"]),
      code: str(values["pairing-code"]),
      name: str(values.name),
    }).filter(([, v]) => v),
  );
}

/** A flag given wins; one left out keeps what the task had (like `install.sh --headless`). */
export function mergePair(given, existing) {
  return {
    hubUrl: given.hubUrl ?? existing.hubUrl,
    code: given.code ?? existing.code,
    name: given.name ?? existing.name,
  };
}

const schtasks = (...args) =>
  execFileSync("schtasks.exe", args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** "Running", "Ready" or "Disabled" in any display language, or undefined when there is no task. */
function status(name) {
  try {
    return (
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-ScheduledTask -TaskPath '\\' -TaskName '${name.replaceAll("'", "''")}' -ErrorAction Stop).State`,
        ],
        { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      ).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function stop(name) {
  if (status(name) !== "Running") return;
  schtasks("/End", "/TN", name);
  // The task's processes end with it (the spike); wait so the installer finds no file in use.
  for (let n = 0; n < 30 && status(name) === "Running"; n++)
    await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 1000));
}

async function main() {
  const here = import.meta.dirname;
  const p = product(here);
  const {
    positionals: [command],
    values: v,
  } = parseArgs({
    allowPositionals: true,
    options: {
      user: { type: "string" },
      "hub-url": { type: "string" },
      "pairing-code": { type: "string" },
      name: { type: "string" },
    },
  });
  mkdirSync(join(here, "logs"), { recursive: true });
  const say = (s) =>
    appendFileSync(join(here, "logs", "headless-task.log"), `${new Date().toISOString()} ${s}\n`);
  // The installer starts this with ShellExec("runas"), which gives it no exit code: it reads this file.
  const result = join(here, "logs", "headless-task.result");
  rmSync(result, { force: true });
  process.on("exit", (code) => writeFileSync(result, String(code)));
  try {
    if (command === "install") {
      // Elevated by someone else (over the shoulder), the task would run as that account with its
      // data, while the files sit in the installing user's folder: refuse.
      const me = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
      if (!v.user || v.user.toLowerCase() !== me.toLowerCase()) {
        say(
          `install: setup runs as ${v.user}, elevated as ${me}; run setup as the administrator the connector should run as`,
        );
        process.exit(2);
      }
      let existing = {};
      try {
        existing = pairFromXml(schtasks("/Query", "/TN", p.name, "/XML"));
      } catch {} // a first install
      const pair = mergePair(
        {
          hubUrl: v["hub-url"] || undefined,
          code: v["pairing-code"] || undefined,
          name: v.name || undefined,
        },
        existing,
      );
      const xml = taskXml({
        user: me,
        node: process.execPath,
        launcher: join(here, "launcher.mjs"),
        dir: here,
        pair,
        description: `Starts ${p.name} at boot, with nobody signed in.`,
      });
      await stop(p.name);
      // schtasks reads the file as UTF-16; it holds the pairing code, so it goes at once.
      const file = join(tmpdir(), `${p.id}-task-${process.pid}.xml`);
      writeFileSync(file, `﻿${xml}`, "utf16le");
      try {
        schtasks("/Create", "/TN", p.name, "/XML", file, "/F");
      } finally {
        rmSync(file, { force: true });
      }
      schtasks("/Run", "/TN", p.name);
      say(
        `install: task "${p.name}" for ${me}, started${pair.hubUrl ? `, hub ${pair.hubUrl}` : ""}`,
      );
    } else if (command === "stop") {
      await stop(p.name);
    } else if (command === "remove") {
      await stop(p.name);
      if (status(p.name) !== undefined) schtasks("/Delete", "/TN", p.name, "/F");
      say(`remove: task "${p.name}" deleted`);
    } else {
      say(`unknown command ${command}`);
      process.exit(1);
    }
  } catch (e) {
    say(`${command}: ${String(e.stderr || e.message).trim()}`);
    process.exit(1);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
