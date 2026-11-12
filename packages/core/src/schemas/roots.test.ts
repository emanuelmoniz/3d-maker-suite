import { describe, expect, it } from "vitest";
import { devicePathIn } from "./roots.ts";

describe("devicePathIn", () => {
  it("compares Windows paths in any case and separator", () => {
    expect(devicePathIn("D:\\Models", "d:\\models\\Acme")).toBe(true);
    expect(devicePathIn("D:\\Models\\", "D:/Models")).toBe(true);
    expect(devicePathIn("D:\\", "D:\\Models")).toBe(true);
    expect(devicePathIn("\\\\nas\\share", "\\\\NAS\\Share\\x")).toBe(true);
  });

  it("refuses a sibling that only shares a prefix", () => {
    expect(devicePathIn("D:\\Mod", "D:\\Models")).toBe(false);
    expect(devicePathIn("/srv/mod", "/srv/models")).toBe(false);
  });

  it("is case-sensitive on posix", () => {
    expect(devicePathIn("/srv/models", "/srv/models/a")).toBe(true);
    expect(devicePathIn("/srv/models", "/srv/Models/a")).toBe(false);
    expect(devicePathIn("/", "/home")).toBe(true);
  });
});
