import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";
import { setRoots } from "./testRoots.ts";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "roots-"));
  await mkdir(join(dir, "data"));
  await mkdir(join(dir, "models", "inner", "001_Cup"), { recursive: true });
  await writeFile(join(dir, "models", "inner", "001_Cup", "cup.stl"), "solid");
  db = openDb(":memory:");
  app = await buildApp(db, false, join(dir, "data"));
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const scan = async () => {
  await app.inject({ method: "POST", url: "/api/projects/scan" });
  await expect.poll(async () => (await app.inject("/api/projects/scan")).json().state).toBe("idle");
  return (await app.inject("/api/projects")).json().items;
};

describe("roots", () => {
  it("adds hub roots named after their folder, in order; refuses a missing or repeated one", async () => {
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/roots", payload });
    expect((await post({ path: join(dir, "nope") })).json().error.code).toBe("invalid_folder");
    expect((await post({ path: "models" })).json().error.code).toBe("invalid_folder");
    const [models, inner] = await setRoots(app, join(dir, "models"), {
      path: join(dir, "models", "inner"),
      projectDepth: 2,
    });
    expect(models).toMatchObject({ name: "models", location: "hub", position: 0, projectDepth: 1 });
    expect(inner).toMatchObject({ name: "inner", position: 1, projectDepth: 2, autoSlice: true });
    expect((await post({ path: join(dir, "models") })).json().error.code).toBe("root_exists");
  });

  it("keeps a root its projects use, and scans a nested root's folders once", async () => {
    const [outer, inner] = await setRoots(
      app,
      { path: join(dir, "models"), projectDepth: 2 },
      join(dir, "models", "inner"),
    );
    // Depth 2 reaches inner/001_Cup from the outer root too: it is the nested root's.
    expect(await scan()).toMatchObject([{ name: "Cup", rootId: inner?.id, folder: "001_Cup" }]);
    const del = (id = "") => app.inject({ method: "DELETE", url: `/api/roots/${id}` });
    expect((await del(inner?.id)).json().error.code).toBe("root_in_use");
    expect((await del(outer?.id)).statusCode).toBe(204);
  });
});

describe("hub switch", () => {
  it("needs user accounts", async () => {
    const patch = (hubEnabled: boolean, cookie = "") =>
      app.inject({
        method: "PATCH",
        url: "/api/preferences",
        payload: { hubEnabled },
        headers: { cookie },
      });
    expect((await patch(true)).json().error.code).toBe("hub_needs_users");
    expect((await patch(false)).statusCode).toBe(200);

    const passwordHash = await hashPassword("correct horse battery");
    db.insert(schema.users)
      .values({ email: "admin@example.com", displayName: "A", role: "admin", passwordHash })
      .run();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "correct horse battery" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    expect(login.statusCode, login.body).toBe(200);
    const on = await patch(true, cookie);
    expect(on.json(), on.body).toMatchObject({ values: { hubEnabled: true } });
  });
});
