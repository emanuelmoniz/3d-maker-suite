import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, loadKey } from "./secrets.ts";

describe("secrets", () => {
  const key = randomBytes(32);

  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt(key, { token: "abc" });
    expect(decrypt(key, a)).toEqual({ token: "abc" });
    expect(encrypt(key, { token: "abc" }).iv).not.toBe(a.iv);
    expect(JSON.stringify(a)).not.toContain("abc");
  });

  it("rejects a wrong key or a tampered blob", () => {
    const blob = encrypt(key, { token: "abc" });
    expect(() => decrypt(randomBytes(32), blob)).toThrow();
    const data = Buffer.from(blob.data, "base64");
    data[0] = (data[0] ?? 0) ^ 1;
    expect(() => decrypt(key, { ...blob, data: data.toString("base64") })).toThrow();
  });

  it("creates the key file once and reuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "3dms-key-"));
    const first = loadKey(dir);
    expect(first).toHaveLength(32);
    expect(loadKey(dir).equals(first)).toBe(true);
  });
});
