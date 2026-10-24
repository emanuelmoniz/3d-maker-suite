import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.ts";

describe("password", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("correct hors", stored)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed or tampered hashes", async () => {
    const stored = await hashPassword("pw");
    const parts = stored.split("$");
    for (const bad of [
      "",
      "pw",
      "bcrypt$x",
      `${stored}$extra`,
      parts.with(5, "").join("$"),
      parts.with(1, "abc").join("$"),
      parts.with(5, Buffer.alloc(64).toString("base64")).join("$"),
    ])
      expect(await verifyPassword("pw", bad)).toBe(false);
  });
});
