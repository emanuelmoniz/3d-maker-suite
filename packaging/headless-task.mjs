// A headless connector on Windows (ADR-0024, Plan 6.3.0 Steps 3b and 5b): the scheduled task that
// starts it at boot with nobody signed in. It runs as the installing administrator without a
// stored password (S4U), or as a named account with its password, which reaches network shares
// (S4U has no network credentials). The install is per-machine (`setup.exe /ALLUSERS`): the
// account runs it from Program Files, with Modify on that folder, and keeps its data in its own
// profile. Setup runs this elevated with the bundled Node, from the install dir:
//   nodew.exe headless-task.mjs install [--account DOMAIN\name --password-file F]
//                                       [--hub-url U --pairing-code C] [--name N]
//     registers the task and starts it. Left out, the address, code, name and account stay what
//     the task has; a first install runs as the installing administrator. The password file is
//     read and deleted at once, and the password goes to Windows on stdin, never on a command line.
//   nodew.exe headless-task.mjs stop     ends a running task and waits for it (setup, before files)
//   nodew.exe headless-task.mjs remove   ends and deletes it, takes back what it granted (uninstaller)
// The task's own restart on failure doesn't react to an exit code (Step 3b), so the launcher
// starts a crashed program again itself. Exit 0 ok, 1 failed, 3 the account can't sign in with
// that password, 4 no such account (or a gMSA), 5 the task runs as a named account and needs its
// password again, 6 a policy refuses the account the batch logon. The reason goes to
// logs/headless-task.log, without the password or the pairing code. Node stdlib only.
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unescapeXml(m[1]) : undefined;
};

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
 * The task: at boot, as `user`, no elevation, one instance, no time limit (the default of 72 hours
 * would end it), priority 5 (the default 7 runs it below normal). `logon` "S4U" stores no password;
 * "Password" is registered with the account's password (Register-ScheduledTask).
 */
export function taskXml({ user, logon = "S4U", node, launcher, dir, pair, description }) {
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
      <LogonType>${logon}</LogonType>
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
  const args = tag(xml, "Arguments");
  if (args === undefined) return {};
  const { values } = parseArgs({
    args: splitArgs(args),
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

/** How an existing task starts: its logon type, and the program and arguments it runs. */
export function taskFromXml(xml) {
  return {
    logon: tag(xml, "LogonType"),
    command: tag(xml, "Command"),
    args: tag(xml, "Arguments"),
    pair: pairFromXml(xml),
  };
}

/** A flag given wins; one left out keeps what the task had (like `install.sh --headless`). */
export function mergePair(given, existing) {
  return {
    hubUrl: given.hubUrl ?? existing.hubUrl,
    code: given.code ?? existing.code,
    name: given.name ?? existing.name,
  };
}

/** `.\name` and a bare `name` are local accounts: `COMPUTER\name`. DOMAIN\name and UPNs stay. */
export function normalizeAccount(account, computer) {
  const a = account.trim();
  if (a.startsWith(".\\")) return `${computer}\\${a.slice(2)}`;
  if (!a.includes("\\") && !a.includes("@")) return `${computer}\\${a}`;
  return a;
}

/** A group managed service account (`name$`): it has no password to give, not supported yet. */
export const isGmsa = (account) => account.trim().endsWith("$");

/**
 * The password in a file: UTF-16 with a BOM, UTF-8 (with or without one), or else the ANSI code
 * page (Windows PowerShell's Set-Content), read as Latin-1. One line break at the end goes.
 */
export function decodePassword(buf) {
  let s;
  if (buf[0] === 0xff && buf[1] === 0xfe) s = buf.subarray(2).toString("utf16le");
  else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    s = buf.subarray(3).toString("utf8");
  else
    try {
      s = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      s = buf.toString("latin1");
    }
  return s.replace(/\r?\n$/, "");
}

/**
 * How to register the task. `target` is the account's SID, `me` the installing administrator's;
 * `existing` the task there is now (`sid` it runs as, `logon`, `same`: it would run the same
 * program with the same arguments). A password registers a Password task; without one, a Password
 * task for the same account is kept as it is when nothing changes (a password isn't needed just to
 * update the files), and S4U is only for the installing administrator.
 */
export function decide({ password, target, me, existing }) {
  if (password) return { logon: "Password" };
  if (existing?.logon === "Password" && existing.sid === target)
    return existing.same ? { logon: "keep" } : { error: 5 };
  if (target === me) return { logon: "S4U" };
  return { error: 5 };
}

/** Text for the log with every secret given taken out. */
export function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s) out = out.replaceAll(s, "***");
  return out;
}

const run = (cmd, args, input) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
const schtasks = (...args) => run("schtasks.exe", args);
const icacls = (...args) => run("icacls.exe", args);

/** "Running", "Ready" or "Disabled" in any display language, or undefined when there is no task. */
function status(name) {
  try {
    return (
      run("powershell.exe", [
        "-NoProfile",
        "-Command",
        `(Get-ScheduledTask -TaskPath '\\' -TaskName '${name.replaceAll("'", "''")}' -ErrorAction Stop).State`,
      ]).trim() || undefined
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

/** An exit with its code: the reason is logged, the code tells setup which message to show. */
class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
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
      account: { type: "string" },
      "password-file": { type: "string" },
      "hub-url": { type: "string" },
      "pairing-code": { type: "string" },
      name: { type: "string" },
    },
  });
  mkdirSync(join(here, "logs"), { recursive: true });
  const say = (s) =>
    appendFileSync(join(here, "logs", "headless-task.log"), `${new Date().toISOString()} ${s}\n`);
  // What it granted, so a switch or the uninstaller takes it back: { account, sid, granted }.
  const stateFile = join(here, "headless-account.json");
  const saved = (() => {
    try {
      return JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      return undefined;
    }
  })();
  let password;
  const secrets = () => [password, v["pairing-code"]];
  /** headless-account.ps1, with the password on stdin; its exit 3, 4 and 6 pass through. */
  const account = (verb, args, withPassword) => {
    try {
      return run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(here, "headless-account.ps1"),
          verb,
          ...args,
        ],
        withPassword ? `${Buffer.from(password, "utf8").toString("base64")}\n` : "",
      ).trim();
    } catch (e) {
      const why = String(e.stderr || e.message).trim();
      throw new Exit([3, 4, 6].includes(e.status) ? e.status : 1, `${verb}: ${why}`);
    }
  };
  try {
    if (command === "install") {
      if (v["password-file"])
        try {
          password = decodePassword(readFileSync(v["password-file"]));
        } finally {
          rmSync(v["password-file"], { force: true });
        }
      const me = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
      const name = v.account
        ? normalizeAccount(v.account, process.env.COMPUTERNAME)
        : (saved?.account ?? me);
      if (isGmsa(name))
        throw new Exit(
          4,
          `${name} is a managed service account (gMSA): give an account with a password`,
        );
      let xmlNow;
      try {
        xmlNow = schtasks("/Query", "/TN", p.name, "/XML");
      } catch {} // a first install
      const now = xmlNow && taskFromXml(xmlNow);
      const pair = mergePair(
        {
          hubUrl: v["hub-url"] || undefined,
          code: v["pairing-code"] || undefined,
          name: v.name || undefined,
        },
        now?.pair ?? {},
      );
      const launcher = join(here, "launcher.mjs");
      const sid = account("sid", [name]);
      const meSid = name.toLowerCase() === me.toLowerCase() ? sid : account("sid", [me]);
      // A task made before this file existed runs S4U as the installing administrator.
      const runsAs = now && (saved?.sid ?? meSid);
      const plan = decide({
        password,
        target: sid,
        me: meSid,
        existing: now && {
          sid: runsAs,
          logon: now.logon,
          same: now.command === process.execPath && now.args === launcherArgs(launcher, pair),
        },
      });
      if (plan.error)
        throw new Exit(
          plan.error,
          `install: the task runs as ${name} with its password; give it again (/PASSWORDFILE) to change the task`,
        );
      if (plan.logon === "keep") {
        schtasks("/Run", "/TN", p.name);
        say(`install: task "${p.name}" for ${name} kept, started`);
        return;
      }
      let granted = saved?.sid === sid && saved.granted;
      if (plan.logon === "Password") {
        const prepared = JSON.parse(account("prepare", [name], true));
        granted ||= prepared.granted;
      }
      // Its program and logs: an account that isn't an administrator can't write Program Files.
      icacls(here, "/grant", `*${sid}:(OI)(CI)M`);
      await stop(p.name);
      // Another account than before: its data (the pairing) goes along through handoff\, which only
      // the new account can read; the launcher moves it into the new account's data folder.
      const switched = runsAs && runsAs !== sid;
      if (switched) {
        const profile = account("profile", [runsAs]);
        const from = profile && join(profile, "AppData", "Roaming", p.id);
        const handoff = join(here, "handoff");
        rmSync(handoff, { recursive: true, force: true });
        if (from && existsSync(join(from, "state.json"))) {
          mkdirSync(handoff);
          // The folder's ACL first, so the files copied in inherit it (Step 5b's spike).
          icacls(
            handoff,
            "/inheritance:r",
            "/grant:r",
            `*${sid}:(OI)(CI)M`,
            "*S-1-5-32-544:(OI)(CI)F",
            "*S-1-5-18:(OI)(CI)F",
          );
          cpSync(from, handoff, { recursive: true });
        }
      }
      const xml = taskXml({
        user: name,
        logon: plan.logon,
        node: process.execPath,
        launcher,
        dir: here,
        pair,
        description: `Starts ${p.name} at boot, with nobody signed in.`,
      });
      // UTF-16, as schtasks reads it; it holds the pairing code, so it goes at once.
      const file = join(tmpdir(), `${p.id}-task-${process.pid}.xml`);
      writeFileSync(file, `﻿${xml}`, "utf16le");
      try {
        if (plan.logon === "Password") account("register", [p.name, file, name], true);
        else schtasks("/Create", "/TN", p.name, "/XML", file, "/F");
      } finally {
        rmSync(file, { force: true });
      }
      if (switched) {
        try {
          icacls(here, "/remove:g", `*${runsAs}`);
        } catch {} // never granted (a Step 3b install)
        if (saved?.sid === runsAs && saved.granted) account("revoke", [runsAs]);
      }
      writeFileSync(stateFile, JSON.stringify({ account: name, sid, granted }));
      schtasks("/Run", "/TN", p.name);
      say(
        `install: task "${p.name}" for ${name} (${plan.logon === "S4U" ? "S4U" : "password"}), started${pair.hubUrl ? `, hub ${pair.hubUrl}` : ""}`,
      );
    } else if (command === "stop") {
      await stop(p.name);
    } else if (command === "remove") {
      await stop(p.name);
      if (status(p.name) !== undefined) schtasks("/Delete", "/TN", p.name, "/F");
      if (saved?.granted) account("revoke", [saved.sid]);
      rmSync(stateFile, { force: true });
      rmSync(join(here, "handoff"), { recursive: true, force: true });
      say(`remove: task "${p.name}" deleted`);
    } else {
      throw new Exit(1, `unknown command ${command}`);
    }
  } catch (e) {
    say(
      redact(
        e instanceof Exit ? e.message : `${command}: ${e.stderr || e.message}`,
        secrets(),
      ).trim(),
    );
    process.exitCode = e instanceof Exit ? e.code : 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
