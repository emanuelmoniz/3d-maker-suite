import { describe, expect, it } from "vitest";
import {
  decide,
  decodePassword,
  isGmsa,
  launcherArgs,
  mergePair,
  normalizeAccount,
  pairFromXml,
  quoteArg,
  redact,
  splitArgs,
  taskFromXml,
  taskXml,
} from "./headless-task.mjs";

const at = {
  user: "SERVER\\admin",
  node: "C:\\Program Files\\3D Maker Suite Connector\\node\\nodew.exe",
  launcher: "C:\\Program Files\\3D Maker Suite Connector\\launcher.mjs",
  dir: "C:\\Program Files\\3D Maker Suite Connector",
  description: "Starts it at boot.",
};

describe("quoteArg and splitArgs", () => {
  it("leaves plain arguments and quotes the rest by Windows rules", () => {
    expect(quoteArg("AB12-CD34")).toBe("AB12-CD34");
    expect(quoteArg("Workshop server")).toBe('"Workshop server"');
    expect(quoteArg("")).toBe('""');
    expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteArg("C:\\a dir\\")).toBe('"C:\\a dir\\\\"');
  });

  it("splits back what it quoted", () => {
    const args = ["C:\\Program Files\\x\\", 'a "b" c', "", "plain", "back\\\\slash", 'q\\"'];
    expect(splitArgs(args.map(quoteArg).join(" "))).toEqual(args);
  });
});

describe("taskXml", () => {
  const xml = taskXml({
    ...at,
    pair: { hubUrl: "https://maker.example.com/?a=1&b=2", code: "AB12-CD34", name: "R&D <lab>" },
  });

  it("starts at boot as the installing user without a stored password, no elevation", () => {
    expect(xml).toContain("<BootTrigger>");
    expect(xml).toContain("<UserId>SERVER\\admin</UserId>");
    expect(xml).toContain("<LogonType>S4U</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  });

  it("has no time limit, normal priority and one instance", () => {
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<Priority>5</Priority>");
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
  });

  it("runs the launcher headless, with the pairing escaped for XML", () => {
    expect(xml).toContain(`<Command>${at.node}</Command>`);
    expect(xml).toContain(
      "--background --headless --hub-url https://maker.example.com/?a=1&amp;b=2",
    );
    expect(xml).toContain("--name &quot;R&amp;D &lt;lab&gt;&quot;");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it("reads back the pairing it carries", () => {
    expect(pairFromXml(xml)).toEqual({
      hubUrl: "https://maker.example.com/?a=1&b=2",
      code: "AB12-CD34",
      name: "R&D <lab>",
    });
    expect(pairFromXml(taskXml({ ...at }))).toEqual({});
    expect(pairFromXml("<Task/>")).toEqual({});
  });

  it("as a named account, its password stored by Windows, not in the task", () => {
    const named = taskXml({ ...at, user: "NAS\\svc-maker", logon: "Password" });
    expect(named).toContain("<UserId>NAS\\svc-maker</UserId>");
    expect(named).toContain("<LogonType>Password</LogonType>");
    expect(named).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  });

  it("reads back how a task starts", () => {
    const pair = { hubUrl: "https://hub", code: "AB12-CD34" };
    const t = taskFromXml(taskXml({ ...at, logon: "Password", pair }));
    expect(t).toEqual({
      logon: "Password",
      command: at.node,
      args: launcherArgs(at.launcher, pair),
      pair,
    });
  });
});

describe("accounts", () => {
  it("makes local accounts COMPUTER\\name and leaves domain accounts and UPNs", () => {
    expect(normalizeAccount(".\\svc", "SRV")).toBe("SRV\\svc");
    expect(normalizeAccount(" svc ", "SRV")).toBe("SRV\\svc");
    expect(normalizeAccount("CORP\\svc", "SRV")).toBe("CORP\\svc");
    expect(normalizeAccount("svc@corp.example", "SRV")).toBe("svc@corp.example");
  });

  it("knows a gMSA", () => {
    expect(isGmsa("CORP\\maker$")).toBe(true);
    expect(isGmsa("CORP\\maker")).toBe(false);
  });

  it("reads a password file in whatever encoding Windows wrote it", () => {
    const pw = "pä \"s$'w rd";
    expect(decodePassword(Buffer.from(pw, "utf8"))).toBe(pw);
    expect(decodePassword(Buffer.from(`﻿${pw}\r\n`, "utf8"))).toBe(pw);
    expect(
      decodePassword(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(pw, "utf16le")])),
    ).toBe(pw);
    // Windows PowerShell's Set-Content: the ANSI code page.
    expect(decodePassword(Buffer.from(`${pw}\n`, "latin1"))).toBe(pw);
    // Only one line break goes; spaces are part of a password.
    expect(decodePassword(Buffer.from(" pw \n\n"))).toBe(" pw \n");
  });

  it("takes secrets out of what it logs", () => {
    expect(redact("failed for p4ss with AB12-CD34", ["p4ss", "AB12-CD34", undefined])).toBe(
      "failed for *** with ***",
    );
  });
});

describe("decide", () => {
  const me = "S-1-5-21-1-500";
  const svc = "S-1-5-21-1-1001";
  const task = (sid, logon, same = true) => ({ sid, logon, same });

  it("a password registers the task with it, for any account", () => {
    expect(decide({ password: "pw", target: svc, me })).toEqual({ logon: "Password" });
    expect(decide({ password: "pw", target: me, me, existing: task(me, "S4U") })).toEqual({
      logon: "Password",
    });
  });

  it("the installing administrator without one runs S4U", () => {
    expect(decide({ target: me, me })).toEqual({ logon: "S4U" });
    expect(decide({ target: me, me, existing: task(svc, "Password") })).toEqual({ logon: "S4U" });
  });

  it("an update keeps a named account's task when nothing else changes", () => {
    expect(decide({ target: svc, me, existing: task(svc, "Password") })).toEqual({ logon: "keep" });
    expect(decide({ target: me, me, existing: task(me, "Password") })).toEqual({ logon: "keep" });
  });

  it("asks for the password again for any other change", () => {
    expect(decide({ target: svc, me, existing: task(svc, "Password", false) })).toEqual({
      error: 5,
    });
    expect(decide({ target: svc, me })).toEqual({ error: 5 });
    expect(decide({ target: svc, me, existing: task(me, "S4U") })).toEqual({ error: 5 });
  });
});

describe("mergePair", () => {
  it("keeps the task's address, code and name for any left out", () => {
    const existing = { hubUrl: "https://a", code: "OLD1-CODE", name: "Server" };
    expect(mergePair({}, existing)).toEqual(existing);
    expect(mergePair({ code: "NEW1-CODE" }, existing)).toEqual({ ...existing, code: "NEW1-CODE" });
    expect(mergePair({ hubUrl: "https://b", code: "C", name: "N" }, {})).toEqual({
      hubUrl: "https://b",
      code: "C",
      name: "N",
    });
  });

  it("a task without a pairing gets none", () => {
    expect(launcherArgs("l.mjs", mergePair({}, {}))).toBe("l.mjs --background --headless");
  });
});
