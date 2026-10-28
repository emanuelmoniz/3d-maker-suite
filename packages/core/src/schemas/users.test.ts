import { describe, expect, it } from "vitest";
import { loginSchema, setupSchema, userSchema } from "./users.ts";

describe("users schemas", () => {
  it("never carries the password hash", () => {
    const user = userSchema.parse({
      id: crypto.randomUUID(),
      email: "a@b.c",
      displayName: "A",
      role: "viewer",
      disabled: false,
      projectsSeeAll: true,
      projectsEditOthers: true,
      editOtherDevices: false,
      lastLoginAt: null,
      createdAt: "2026-10-24T00:00:00.000Z",
      updatedAt: "2026-10-24T00:00:00.000Z",
      passwordHash: "scrypt$...",
    });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("trims and lower-cases the email", () => {
    expect(loginSchema.parse({ email: " Me@Example.COM ", password: "x" }).email).toBe(
      "me@example.com",
    );
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });

  it("asks for a real password at setup", () => {
    const base = { email: "a@example.com", displayName: "A" };
    expect(setupSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, password: "x".repeat(257) }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, password: "long enough" }).success).toBe(true);
  });
});
