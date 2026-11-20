import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCS_URL } from "@3d-maker-suite/core";
import { openDb } from "@3d-maker-suite/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { registerGuide } from "./lib/guide.ts";

const dir = mkdtempSync(join(tmpdir(), "guide-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Accounts on, nobody signed in: the strictest case. */
const app = async (guide: string) => {
  const a = await buildApp(openDb(":memory:"), false, "", {});
  await registerGuide(a, guide); // before the first request, as main.ts does
  await a.inject({
    method: "POST",
    url: "/api/auth/setup",
    payload: { displayName: "Ana", email: "ana@example.com", password: "correct horse" },
  });
  return a;
};

describe("the guide at /guide/", () => {
  const root = join(dir, "guide");
  beforeAll(() => {
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<h1>Home</h1>");
    writeFileSync(join(root, "Printers.html"), '<h1 id="printers-list">Printers</h1>');
    writeFileSync(join(root, "assets", "printers.webp"), "webp");
  });

  it("serves the home, a page by its clean address, and an image, with no sign-in", async () => {
    const a = await app(root);
    const get = (url: string) => a.inject({ url });
    expect((await get("/guide/")).body).toContain("Home");
    const page = await get("/guide/Printers");
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("printers-list");
    expect((await get("/guide/Printers?x=1#printers-list")).statusCode).toBe(200);
    expect((await get("/guide/assets/printers.webp")).body).toBe("webp");
    expect((await get("/guide")).headers.location).toBe("/guide/");
  });

  it("answers 404 for a page it doesn't have, not the app", async () => {
    const a = await app(root);
    expect((await a.inject({ url: "/guide/Nope" })).statusCode).toBe(404);
  });

  it("not built: /guide/ goes to the same page of the public site", async () => {
    const a = await app(join(dir, "missing"));
    for (const [url, to] of [
      ["/guide", DOCS_URL],
      ["/guide/", `${DOCS_URL}/`],
      ["/guide/Printers", `${DOCS_URL}/Printers`],
      ["/guide/Printers?x=1", `${DOCS_URL}/Printers`],
    ]) {
      const res = await a.inject({ url });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(to);
    }
  });
});
