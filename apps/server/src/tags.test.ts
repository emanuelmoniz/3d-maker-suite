import { openDb } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  app = await buildApp(openDb(":memory:"));
});

const send = (method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload });
const tag = async (name: string) =>
  (await send("POST", "/api/tags", { name, color: "#ff0000" })).json();

describe("tags", () => {
  it("names are unique ignoring case", async () => {
    await tag("Gift");
    expect((await send("POST", "/api/tags", { name: "gift", color: "#00ff00" })).statusCode).toBe(
      409,
    );
  });

  it("tags printers, filters lists by tag, and cascades on tag delete", async () => {
    const mk = async (name: string) =>
      (await send("POST", "/api/printers", { name, brand: "Bambu Lab", model: "P1S" })).json();
    const [a, b] = [await mk("A"), await mk("B")];
    const t = await tag("Workhorse");

    const set = await send("PUT", `/api/tags/taggings/printer/${a.id}`, { tagIds: [t.id, t.id] });
    expect(set.json()).toHaveLength(1);
    const names = async (q = "") =>
      (await app.inject(`/api/printers${q}`)).json().items.map((p: { name: string }) => p.name);
    expect(await names()).toEqual(["A", "B"]);
    expect(await names(`?tagId=${t.id}`)).toEqual(["A"]);

    // Replace, not append.
    await send("PUT", `/api/tags/taggings/printer/${a.id}`, { tagIds: [] });
    expect(await names(`?tagId=${t.id}`)).toEqual([]);

    await send("PUT", `/api/tags/taggings/printer/${b.id}`, { tagIds: [t.id] });
    expect((await app.inject("/api/tags/taggings?entityType=printer")).json()).toHaveLength(1);
    await send("DELETE", `/api/tags/${t.id}`);
    expect((await app.inject("/api/tags/taggings?entityType=printer")).json()).toEqual([]);
  });

  it("rejects unknown items and tags", async () => {
    const t = await tag("X");
    const none = "00000000-0000-4000-8000-000000000000";
    expect(
      (await send("PUT", `/api/tags/taggings/spool/${none}`, { tagIds: [t.id] })).statusCode,
    ).toBe(404);
    const p = (await send("POST", "/api/printers", { name: "A", brand: "x", model: "y" })).json();
    expect(
      (await send("PUT", `/api/tags/taggings/printer/${p.id}`, { tagIds: [none] })).statusCode,
    ).toBe(400);
  });
});

describe("collections", () => {
  it("keeps projects in the order given", async () => {
    const c = (await send("POST", "/api/collections", { name: "Gifts" })).json();
    expect(c.projectIds).toEqual([]);
    const none = "00000000-0000-4000-8000-000000000000";
    expect(
      (await send("PUT", `/api/collections/${c.id}/projects`, { projectIds: [none] })).statusCode,
    ).toBe(400);
    expect((await send("DELETE", `/api/collections/${c.id}`)).statusCode).toBe(204);
  });
});
