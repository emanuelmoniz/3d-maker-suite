import { describe, expect, it } from "vitest";
import {
  launcherArgs,
  mergePair,
  pairFromXml,
  quoteArg,
  splitArgs,
  taskXml,
} from "./headless-task.mjs";

const at = {
  user: "SERVER\\admin",
  node: "C:\\Users\\admin\\AppData\\Local\\Programs\\3D Maker Suite Connector\\node\\nodew.exe",
  launcher: "C:\\Users\\admin\\AppData\\Local\\Programs\\3D Maker Suite Connector\\launcher.mjs",
  dir: "C:\\Users\\admin\\AppData\\Local\\Programs\\3D Maker Suite Connector",
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
