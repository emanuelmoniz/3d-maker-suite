import { openDb } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  app = await buildApp(openDb(":memory:"), false, ".");
});

const req = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, payload });
const create = (payload: Record<string, unknown> = {}) =>
  req("POST", "/api/clients", { name: "Ana", mobile: "911", ...payload });

describe("clients", () => {
  it("CRUD; blank optional fields are stored as null", async () => {
    const c = (await create({ vat: "  ", email: "", address: "Rua 1" })).json();
    expect(c).toMatchObject({ name: "Ana", vat: null, email: null, address: "Rua 1" });
    expect((await req("PATCH", `/api/clients/${c.id}`, { notes: "VIP" })).json().notes).toBe("VIP");
    expect((await req("GET", "/api/clients?name=an")).json().total).toBe(1);
    expect((await create({ name: "" })).statusCode).toBe(400);
    expect((await create({ email: "nope" })).statusCode).toBe(400);
  });

  it("duplicate vat, mobile and email (any case) are 409s naming the field", async () => {
    await create({ vat: "PT1", email: "A@x.com" });
    const code = async (p: Record<string, unknown>) => (await create(p)).json().error?.code;
    expect(await code({ mobile: "912", vat: "PT1" })).toBe("client_vat_taken");
    expect(await code({ mobile: "911" })).toBe("client_mobile_taken");
    expect(await code({ mobile: "913", email: "a@X.COM" })).toBe("client_email_taken");
    // blanks never clash
    expect((await create({ mobile: "914" })).statusCode).toBe(201);
    expect((await create({ mobile: "915" })).statusCode).toBe(201);

    const other = (await create({ mobile: "916", vat: "PT2" })).json();
    const clash = await req("PATCH", `/api/clients/${other.id}`, { vat: "PT1" });
    expect([clash.statusCode, clash.json().error.code]).toEqual([409, "client_vat_taken"]);
    expect((await req("PATCH", `/api/clients/${other.id}`, { vat: "PT2" })).statusCode).toBe(200);
  });
});
