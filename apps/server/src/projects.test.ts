import { cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { mockAdapter } from "@3d-maker-suite/adapter-mock";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import { modelIdFor } from "./lib/catalog.ts";
import { setRoots as setAllRoots } from "./testRoots.ts";

// A folder that fails to read: permissions or a disk error can't be set up the same on every OS.
vi.mock("@3d-maker-suite/host", async (original) => {
  const real = await original<typeof import("@3d-maker-suite/host")>();
  return {
    ...real,
    scanFolder: (...args: Parameters<typeof real.scanFolder>) =>
      /[\\/]new[\\/]Unreadable$/.test(args[0])
        ? Promise.reject(new Error("EIO"))
        : real.scanFolder(...args),
  };
});

const fixtures = join(import.meta.dirname, "../../../packages/3mf/fixtures");

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "projects-"));
  await mkdir(join(dir, "data"));
  const slicer = {
    ...mockAdapter(),
    id: "slicer",
    kind: "local" as const,
    capabilities: ["openInSlicer" as const],
  };
  db = openDb(":memory:");
  app = await buildApp(db, false, join(dir, "data"), { adapters: [slicer] });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const root = () => join(dir, "models");
const put = async (path: string, content: string | Buffer) => {
  await mkdir(join(root(), path, ".."), { recursive: true });
  await writeFile(join(root(), path), content);
};
const setRoots = (projectDepth = 1) => setAllRoots(app, { path: root(), projectDepth });

async function scan() {
  const res = await app.inject({ method: "POST", url: "/api/projects/scan" });
  expect(res.statusCode).toBe(202);
  for (;;) {
    const s = (await app.inject("/api/projects/scan")).json();
    if (s.state === "idle") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
}
const list = async () => (await app.inject("/api/projects?sort=name")).json().items;
const byName = async (name: string) =>
  (await list()).find((p: { name: string }) => p.name === name);

async function sampleTree() {
  await mkdir(join(root(), "Benchy"), { recursive: true });
  await cp(join(fixtures, "multi_color.3mf"), join(root(), "Benchy", "benchy.3mf"));
  await put(
    "Benchy/README.md",
    "# Benchy\nA tiny boat.\nSee https://www.printables.com/model/123-benchy.",
  );
  await put("Benchy/images/cover.png", Buffer.from("png"));
  await put("Vase/vase.stl", "solid");
  await put("Vase/page.url", "[InternetShortcut]\nURL=https://makerworld.com/en/models/99\n");
  await put("Notes/notes.txt", "no model here");
  await put("Cat/Ears/ears.stl", "solid");
}

describe("project scanner", () => {
  it("turns folders with models into projects", async () => {
    await sampleTree();
    await setRoots();
    const status = await scan();
    expect(status).toMatchObject({ created: 3, failed: 0, total: 4 }); // Notes is not a project
    expect((await list()).map((p: { name: string }) => p.name)).toEqual(["Benchy", "Cat", "Vase"]);
    // The pickers ask for `-name` (useProjects): newest number first.
    const newest = (await app.inject("/api/projects?sort=-name")).json().items;
    expect(newest.map((p: { name: string }) => p.name)).toEqual(["Vase", "Cat", "Benchy"]);

    const benchy = await byName("Benchy");
    expect(benchy).toMatchObject({
      description: null, // readme text is not used unless linked
      sourceUrl: "https://www.printables.com/model/123-benchy",
      editedFields: [],
    });
    expect(benchy.meta.multicolor).toBe(true);
    expect(benchy.meta.models[0].plates.length).toBeGreaterThan(0);
    expect(benchy.meta.files.map((f: { path: string }) => f.path)).toContain("images/cover.png");
    expect(benchy.filePath).toBe("benchy.3mf");
    const thumb = await app.inject(`/api/projects/${benchy.id}/thumbnail`);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toBe("image/png");

    expect((await byName("Vase")).sourceUrl).toBe("https://makerworld.com/en/models/99");
  });

  it("numbers projects from the folder prefix, else the next free number; 0 is skipped", async () => {
    await put("000_template/t.stl", "solid");
    await put("003_boat/b.stl", "solid");
    await put("Plain/p.stl", "solid");
    await put("5 - Vase/v.stl", "solid");
    await put("003_zcopy/c.stl", "solid"); // 3 is taken, so it gets the next free one
    await setRoots();
    expect(await scan()).toMatchObject({ created: 4, failed: 0 });
    const found = (await list()).map((p: { number: number; name: string }) => [p.number, p.name]);
    // The first folder of a number goes first, so a duplicate or "Plain" cannot take 5.
    expect(found).toEqual([
      [3, "boat"],
      [5, "Vase"],
      [6, "zcopy"],
      [7, "Plain"],
    ]);
    // A re-scan renumbers nothing.
    await scan();
    expect((await list()).map((p: { number: number }) => p.number)).toEqual([3, 5, 6, 7]);
  });

  it("a numbered folder becomes the folder of a folderless project with its number", async () => {
    // As a prints import creates it: number 3, no folder.
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Boat Test", number: 3 },
    });
    await put("003_boat-test/b.stl", "solid");
    await setRoots();
    expect(await scan()).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(await list()).toMatchObject([
      { number: 3, name: "Boat Test", folderPath: join(root(), "003_boat-test") },
    ]);
  });

  it("watched folders stay renamable and a rename triggers a re-scan", async () => {
    await app.close();
    app = await buildApp(openDb(":memory:"), false, join(dir, "data"), { watchProjects: true });
    await put("Cat/Vase/vase.stl", "solid");
    await put("Cat/Vase/images/cover.png", "png"); // a watched subfolder is what locks Vase
    await setRoots(2);
    await scan();
    expect(await byName("Vase")).toBeDefined();

    await new Promise((r) => setTimeout(r, 1000)); // let the watcher settle
    await rename(join(root(), "Cat", "Vase"), join(root(), "Cat", "Pot")); // EPERM if locked
    await expect.poll(() => byName("Pot"), { timeout: 10_000, interval: 200 }).toBeDefined();
  }, 15_000);

  it("honours the scan depth", async () => {
    await sampleTree();
    await setRoots(2);
    await scan();
    expect((await list()).map((p: { name: string }) => p.name)).toContain("Ears");
  });

  it("each root has its own project depth", async () => {
    await sampleTree();
    const other = join(dir, "other");
    await mkdir(join(other, "Shelf", "Lamp"), { recursive: true });
    await writeFile(join(other, "Shelf", "Lamp", "lamp.stl"), "solid");
    await setAllRoots(app, root(), { path: other, projectDepth: 2 });
    await scan();
    // Depth 1: Cat is the project (Ears inside it). Depth 2: Lamp, not Shelf.
    const names = (await list()).map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Cat", "Lamp"]));
    expect(names).not.toContain("Ears");
    expect(names).not.toContain("Shelf");
  });

  it("lists files down to the root's files depth", async () => {
    await sampleTree();
    await put("Benchy/a/b/deep.png", "png");
    const filesDepth = async (depth: number | null) => {
      await setAllRoots(app, { path: root(), filesDepth: depth });
      await scan();
      return (await byName("Benchy")).meta.files.map((f: { path: string }) => f.path);
    };
    expect(await filesDepth(null)).toEqual(expect.arrayContaining(["a/b/deep.png"]));
    const one = await filesDepth(1);
    expect(one).toContain("images/cover.png");
    expect(one).not.toContain("a/b/deep.png");
    expect(await filesDepth(0)).not.toContain("images/cover.png");
  });

  it("re-scan keeps edited fields and refreshes the rest", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const { id } = await byName("Benchy");
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/projects/${id}`,
      payload: { name: "My Benchy" },
    });
    expect(patch.json().editedFields).toEqual(["name"]);

    await put("Benchy/README.md", "Now with a new description.");
    await put("Benchy/extra.stl", "solid");
    const status = await scan();
    expect(status).toMatchObject({ created: 0, updated: 1 });

    const after = (await app.inject(`/api/projects/${id}`)).json();
    expect(after.name).toBe("My Benchy");
    expect(after.description).toBeNull();
    expect(after.sourceUrl).toBeNull(); // the link left the README
    expect(after.meta.files.map((f: { path: string }) => f.path)).toContain("extra.stl");

    // A second, unchanged scan touches nothing.
    expect(await scan()).toMatchObject({ created: 0, updated: 0 });
  });

  it("links a description file, follows it on re-scan and unlinks on hand edit", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const { id } = await byName("Benchy");
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: `/api/projects/${id}`, payload });
    const get = async () => (await app.inject(`/api/projects/${id}`)).json();

    expect((await patch({ descriptionFile: "../outside.md" })).statusCode).toBe(404);
    const linked = (await patch({ descriptionFile: "README.md" })).json();
    expect(linked.descriptionFile).toBe("README.md");
    expect(linked.description).toContain("A tiny boat.");
    expect(linked.editedFields).not.toContain("description");

    await put("Benchy/README.md", "Changed text.");
    await scan();
    expect((await get()).description).toBe("Changed text.");

    const hand = (await patch({ description: "Mine" })).json();
    expect(hand).toMatchObject({ description: "Mine", descriptionFile: null });
    await put("Benchy/README.md", "Again.");
    await scan();
    expect((await get()).description).toBe("Mine");
  });

  it("keeps a chosen preview file across re-scans until it is gone or reset", async () => {
    await put("Boat/a.stl", "solid");
    await put("Boat/b.stl", "solid");
    await setRoots();
    await scan();
    const { id, filePath } = await byName("Boat");
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: `/api/projects/${id}`, payload });
    const get = async () => (await app.inject(`/api/projects/${id}`)).json();
    const other = filePath === "a.stl" ? "b.stl" : "a.stl";

    expect((await patch({ previewFile: "../x.stl" })).statusCode).toBe(404);
    expect((await patch({ previewFile: "missing.stl" })).statusCode).toBe(404);
    const picked = (await patch({ previewFile: other })).json();
    expect(picked).toMatchObject({ filePath: other, editedFields: ["filePath"] });
    await scan();
    expect((await get()).filePath).toBe(other);

    await rm(join(root(), "Boat", other));
    await scan();
    expect((await get()).filePath).toBe(filePath);

    await put(basename(other) === "a.stl" ? "Boat/a.stl" : "Boat/b.stl", "solid");
    await patch({ previewFile: basename(other) });
    expect((await patch({ previewFile: null })).json().editedFields).toEqual([]);
  });

  it("reports roots that do not exist", async () => {
    await mkdir(root());
    await setRoots();
    await rm(root(), { recursive: true });
    expect((await scan()).missingRoots).toEqual([root()]);
  });
});

describe("manual projects", () => {
  it("get the next free number, or the one given; a taken one is a 409", async () => {
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/projects", payload });
    expect((await post({ name: "A" })).json().number).toBe(1);
    expect((await post({ name: "B", number: 10 })).json().number).toBe(10);
    expect((await post({ name: "C" })).json().number).toBe(11);
    const taken = await post({ name: "D", number: 10 });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe("project_number_taken");
    const a = (await list()).find((p: { name: string }) => p.name === "A");
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: `/api/projects/${a.id}`, payload });
    expect((await patch({ number: 10 })).statusCode).toBe(409);
    const ok = (await patch({ number: 2 })).json();
    expect(ok).toMatchObject({ number: 2, editedFields: ["name"] });
    // The display name leads the filter: 011 is "C".
    expect((await app.inject("/api/projects?name=011-c")).json().items).toHaveLength(1);
  });

  it("can be created without a folder and edited", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Idea", description: "Someday" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "Idea",
      folderPath: null,
      editedFields: ["name", "description"],
    });
  });

  it("can point at a folder, which is scanned but keeps the given name", async () => {
    await sampleTree();
    const payload = { name: "Boat", folderPath: join(root(), "Benchy") };
    // Outside every root: refused, it could never be opened.
    const outside = await app.inject({ method: "POST", url: "/api/projects", payload });
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error.code).toBe("outside_roots");
    await setRoots();
    const res = await app.inject({ method: "POST", url: "/api/projects", payload });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "Boat", editedFields: ["name"] });
    expect(res.json().meta.files.length).toBeGreaterThan(0);

    expect((await app.inject({ method: "POST", url: "/api/projects", payload })).statusCode).toBe(
      409,
    );
    const missing = { name: "X", folderPath: join(root(), "nope") };
    expect(
      (await app.inject({ method: "POST", url: "/api/projects", payload: missing })).statusCode,
    ).toBe(400);

    // A later scan of the roots finds the same folder and leaves the name alone.
    await scan();
    expect(
      (await list()).filter((p: { folderPath: string }) => p.folderPath?.endsWith("Benchy")),
    ).toHaveLength(1);
    expect((await byName("Boat")).name).toBe("Boat");
  });

  it("rejects non-http source links", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Bad", sourceUrl: "javascript:alert(1)" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("project folder: create, link, unlink, missing", () => {
  const create = async (name = "Idea") =>
    (await app.inject({ method: "POST", url: "/api/projects", payload: { name } })).json();
  const detail = async (id: string) => (await app.inject(`/api/projects/${id}`)).json();
  const folder = (id: string, payload: object) =>
    app.inject({ method: "POST", url: `/api/projects/${id}/folder`, payload });
  const unlink = (id: string, files: "trash" | "keep" = "trash") =>
    app.inject({ method: "DELETE", url: `/api/projects/${id}/folder?files=${files}` });
  const plateOf = (projectId: string) =>
    db
      .insert(schema.projectSlicePlates)
      .values({
        projectId,
        file: "benchy.3mf",
        plate: 1,
        fileSize: 1,
        fileMtimeMs: 1,
        fileSha256: "x",
      })
      .run();
  const plates = () => db.select().from(schema.projectSlicePlates).all();

  it("creates NNN_name in the root, or in the one picked when there are several", async () => {
    const p = await create();
    expect((await detail(p.id)).folderState).toBeNull();
    expect((await folder(p.id, {})).json().error.code).toBe("no_project_root");
    await mkdir(root(), { recursive: true });
    await setRoots();
    const res = await folder(p.id, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ folderPath: join(root(), "001_Idea"), folderState: "ok" });
    expect((await folder(p.id, {})).json().error.code).toBe("has_folder");

    const other = join(dir, "other");
    await mkdir(other);
    const [, more] = await setAllRoots(app, root(), other);
    const q = await create("Two");
    expect((await folder(q.id, {})).json().error.code).toBe("root_required");
    expect((await folder(q.id, { rootId: more?.id })).json().folderPath).toBe(
      join(other, "002_Two"),
    );
  });

  it("links an existing folder inside a root that no other project uses", async () => {
    await sampleTree();
    await setRoots();
    const p = await create();
    const outside = join(dir, "outside");
    await mkdir(outside);
    const refused = await folder(p.id, { path: outside });
    expect([refused.statusCode, refused.json().error.code]).toEqual([403, "outside_roots"]);
    expect((await folder(p.id, { path: join(root(), "nope") })).statusCode).toBe(400);

    const res = await folder(p.id, { path: join(root(), "Benchy") });
    expect(res.statusCode).toBe(200);
    // Scanned, but the typed name stays.
    expect(res.json()).toMatchObject({ name: "Idea", folderState: "ok" });
    expect(res.json().meta.files.length).toBeGreaterThan(0);

    const q = await create("Other");
    const taken = await folder(q.id, { path: join(root(), "Benchy") });
    expect([taken.statusCode, taken.json().error.code]).toEqual([409, "folder_in_use"]);
  });

  it("unlink to the trash: the folder moves to its root's trash, the project forgets it", async () => {
    await sampleTree();
    await setRoots();
    const p = await create();
    await folder(p.id, { path: join(root(), "Benchy") });
    plateOf(p.id);
    const res = await unlink(p.id, "trash");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      folderPath: null,
      unlinkedFolder: null,
      filePath: null,
      folderState: null,
      meta: { files: [], models: [] },
    });
    expect(plates()).toEqual([]);
    const { trashedTo } = res.json();
    expect(trashedTo).toMatch(/[\\/]\.3d-maker-suite-trash[\\/].+_Benchy$/);
    expect((await stat(join(trashedTo, "benchy.3mf"))).isFile()).toBe(true);
    await expect(stat(join(root(), "Benchy"))).rejects.toThrow();
    expect((await unlink(p.id)).statusCode).toBe(404);
  });

  it("unlink and keep: scans skip the folder, linking it again keeps everything", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const benchy = await byName("Benchy");
    plateOf(benchy.id);
    const res = await unlink(benchy.id, "keep");
    expect(res.json()).toMatchObject({
      folderPath: null,
      unlinkedFolder: join(root(), "Benchy"),
      folderState: null,
    });
    expect(res.json().trashedTo).toBeUndefined();
    // Nothing moved, nothing forgotten; a scan neither re-adopts it nor makes a twin.
    expect((await stat(join(root(), "Benchy", "benchy.3mf"))).isFile()).toBe(true);
    expect(res.json().meta.files.length).toBeGreaterThan(0);
    await scan();
    expect((await list()).filter((p: { name: string }) => p.name === "Benchy")).toHaveLength(1);
    expect((await byName("Benchy")).folderPath).toBeNull();

    const again = await folder(benchy.id, { path: join(root(), "Benchy") });
    expect(again.json()).toMatchObject({ folderState: "ok", unlinkedFolder: null });
    expect(plates()).toHaveLength(1);
  });

  it("switching folders lets go of the current one as asked; another folder starts clean", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const benchy = await byName("Benchy");
    plateOf(benchy.id);
    // No model in it, so no project has it yet.
    const notes = join(root(), "Notes");
    expect((await folder(benchy.id, { path: notes })).json().error.code).toBe("has_folder");

    const res = await folder(benchy.id, { path: notes, previous: "keep" });
    expect(res.json()).toMatchObject({
      folderPath: notes,
      unlinkedFolder: join(root(), "Benchy"),
      folderState: "ok",
    });
    expect(plates()).toEqual([]);
    // The kept folder is still skipped: no new project for it.
    await scan();
    expect((await list()).map((p: { folderPath: string | null }) => p.folderPath)).not.toContain(
      join(root(), "Benchy"),
    );
  });

  it("switching can move the content along; a name clash moves nothing", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const benchy = await byName("Benchy");
    const content = await app.inject(`/api/projects/${benchy.id}/folder/content`);
    expect(content.json()).toEqual({ hasFiles: true });

    const target = join(root(), "Target");
    await put("Target/benchy.3mf", "x");
    const clash = await folder(benchy.id, { path: target, previous: "move" });
    expect(clash.json().error.code).toBe("folder_exists");
    expect((await stat(join(root(), "Benchy", "benchy.3mf"))).isFile()).toBe(true);

    await rm(join(target, "benchy.3mf"));
    const res = await folder(benchy.id, { path: target, previous: "move" });
    expect(res.json()).toMatchObject({ folderPath: target, unlinkedFolder: null });
    expect((await stat(join(target, "benchy.3mf"))).isFile()).toBe(true);
    await expect(stat(join(root(), "Benchy"))).rejects.toThrow();
  });

  it("a deleted folder is missing; another can be linked or the folder made again", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const vase = await byName("Vase");
    await rm(join(root(), "Vase"), { recursive: true });
    expect((await detail(vase.id)).folderState).toBe("missing");
    const res = await folder(vase.id, {});
    expect(res.json()).toMatchObject({
      folderPath: join(root(), `${String(vase.number).padStart(3, "0")}_Vase`),
      folderState: "ok",
    });
  });

  it("deletes a project without prints; its folder too, only when no file is left in it", async () => {
    await mkdir(root(), { recursive: true });
    await setRoots();
    const del = (id: string) => app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    const code = async (id: string) => (await del(id)).json().error.code;

    // A folder with a file stays, and so does its project.
    const p = await create("Boat");
    const dirOf = (await folder(p.id, {})).json().folderPath;
    await put(`${basename(dirOf)}/hull.stl`, "solid");
    expect(await code(p.id)).toBe("folder_has_files");
    // Empty folders and OS clutter don't count: the folder goes with the project.
    await rm(join(dirOf, "hull.stl"));
    await put(`${basename(dirOf)}/parts/desktop.ini`, "x");
    expect((await del(p.id)).statusCode).toBe(204);
    expect((await app.inject(`/api/projects/${p.id}`)).statusCode).toBe(404);
    await expect(stat(dirOf)).rejects.toThrow();

    // A print keeps its project; a project without a folder just goes.
    const q = await create("Printed");
    const printer = db
      .insert(schema.printers)
      .values({ number: 1, name: "p", modelId: modelIdFor(db, "b", "m") })
      .returning()
      .get();
    const print = db
      .insert(schema.prints)
      .values({
        number: 1,
        printerId: printer.id,
        projectId: q.id,
        title: "x",
        startedAt: "2026-03-01T10:00:00.000Z",
        outcome: "success",
      })
      .returning()
      .get();
    expect(await code(q.id)).toBe("in_use");
    db.delete(schema.prints).where(eq(schema.prints.id, print.id)).run();
    expect((await del(q.id)).statusCode).toBe(204);
  });

  it("a renamed numbered folder stays the same project, not a twin", async () => {
    await put("004_boat/b.stl", "solid");
    await setRoots();
    await scan();
    const boat = (await list())[0];
    await rename(join(root(), "004_boat"), join(root(), "004_ship"));
    await scan();
    expect(await list()).toMatchObject([
      { id: boat.id, number: 4, folderPath: join(root(), "004_ship") },
    ]);
  });
});

describe("changing the root of many projects", () => {
  const target = () => join(dir, "new");
  const twoRoots = async () => {
    await mkdir(root(), { recursive: true });
    await mkdir(target(), { recursive: true });
    const [, to] = await setAllRoots(
      app,
      { path: root(), projectDepth: 2 },
      { path: target(), projectDepth: 2 },
    );
    return to?.id ?? "";
  };
  const relink = (ids: string[], rootId: string) =>
    app.inject({ method: "POST", url: "/api/projects/relink", payload: { ids, rootId } });
  const idle = async () => {
    while ((await app.inject("/api/projects/scan")).json().state !== "idle")
      await new Promise((r) => setTimeout(r, 10));
  };
  const detail = async (id: string) => (await app.inject(`/api/projects/${id}`)).json();
  /** Every path below the roots, with size and mtime: any write shows. */
  const disk = async () => {
    const out: string[] = [];
    for (const base of [root(), target()])
      for (const e of await readdir(base, { recursive: true, withFileTypes: true })) {
        const path = join(e.parentPath, e.name);
        const s = await stat(path);
        out.push(`${path} ${s.size} ${s.mtimeMs}`);
      }
    return out.sort();
  };

  it("moved projects keep their relative folder, files and plates; no file is touched", async () => {
    const to = await twoRoots();
    await put("a/012_vase/vase.stl", "solid");
    await mkdir(join(root(), "Benchy"));
    await cp(join(fixtures, "multi_color.3mf"), join(root(), "Benchy", "benchy.3mf"));
    await scan();
    const vase = await byName("vase");
    const benchy = await byName("Benchy");
    db.insert(schema.projectSlicePlates)
      .values({
        projectId: benchy.id,
        file: "benchy.3mf",
        plate: 1,
        fileSize: 1,
        fileMtimeMs: 1,
        fileSha256: "x",
      })
      .run();
    // The user moves the files.
    await mkdir(join(target(), "a"));
    await rename(join(root(), "a", "012_vase"), join(target(), "a", "012_vase"));
    await rename(join(root(), "Benchy"), join(target(), "Benchy"));
    const before = await disk();

    const res = await relink([vase.id, benchy.id, vase.id], to);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      moved: [
        { id: vase.id, folderState: "ok" },
        { id: benchy.id, folderState: "ok" },
      ],
      skipped: [],
    });
    await idle();

    expect(await disk()).toEqual(before);
    expect(await detail(vase.id)).toMatchObject({
      number: 12,
      rootId: to,
      folder: "a/012_vase",
      folderPath: join(target(), "a", "012_vase"),
      // Its old folder is gone: nothing to skip.
      unlinkedFolder: null,
    });
    const after = await detail(benchy.id);
    expect(after.meta.models).toEqual(benchy.meta.models);
    expect(db.select().from(schema.projectSlicePlates).all()).toHaveLength(1);
    expect(await list()).toHaveLength(2);
  });

  it("a folder not at the new root reads missing; the old one doesn't come back as a twin", async () => {
    const to = await twoRoots();
    await put("012_vase/vase.stl", "solid");
    await scan();
    const vase = await byName("vase");
    const before = await disk();

    expect((await relink([vase.id], to)).json().moved).toEqual([
      { id: vase.id, folderState: "missing" },
    ]);
    await idle();
    await scan();

    expect(await disk()).toEqual(before);
    expect(await list()).toHaveLength(1);
    const after = await detail(vase.id);
    expect(after).toMatchObject({
      rootId: to,
      folderState: "missing",
      unlinkedFolder: join(root(), "012_vase"),
    });
    expect(after.meta.files).toEqual(vase.meta.files);
    const rows = (await app.inject("/api/projects/folders")).json();
    expect(rows).toEqual([
      {
        id: vase.id,
        number: 12,
        name: "vase",
        rootId: to,
        folder: "012_vase",
        folderPath: join(target(), "012_vase"),
        folderState: "missing",
        canEdit: true,
        archivedAt: null,
      },
    ]);

    // The old root isn't in use any more, and its removal lets go of the remembered folder.
    const [from] = (await app.inject("/api/roots")).json();
    const removed = await app.inject({ method: "DELETE", url: `/api/roots/${from.id}` });
    expect(removed.statusCode).toBe(204);
    expect((await detail(vase.id)).unlinkedFolder).toBeNull();
  });

  it("skips what can't move and reports why; the others go through", async () => {
    const to = await twoRoots();
    await put("Same/a.stl", "solid");
    await put("Other/b.stl", "solid");
    await put("Unreadable/c.stl", "solid");
    await scan();
    const same = await byName("Same");
    const other = await byName("Other");
    const bad = await byName("Unreadable");
    // A project already holds the target of Same; Unreadable's new folder fails to scan (the mock).
    await mkdir(join(target(), "Same"));
    await writeFile(join(target(), "Same", "x.stl"), "solid");
    await mkdir(join(target(), "Unreadable"));
    await scan();
    const holder = (await list()).find(
      (p: { folderPath: string }) => p.folderPath === join(target(), "Same"),
    );
    const noFolder = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Idea" } })
    ).json();
    const unknown = "00000000-0000-4000-8000-000000000000";

    const res = await relink([same.id, other.id, bad.id, noFolder.id, unknown, holder.id], to);
    expect(res.json()).toEqual({
      moved: [{ id: other.id, folderState: "missing" }],
      skipped: [
        {
          id: same.id,
          code: "folder_in_use",
          usedBy: { number: holder.number, name: holder.name },
        },
        { id: bad.id, code: "scan_failed" },
        { id: noFolder.id, code: "no_folder" },
        { id: unknown, code: "not_found" },
        { id: holder.id, code: "same_root" },
      ],
    });
    await idle();
    expect(await detail(same.id)).toMatchObject({ rootId: same.rootId, unlinkedFolder: null });
    expect(await detail(bad.id)).toMatchObject({ rootId: bad.rootId, unlinkedFolder: null });
  });

  it("two selected projects with one relative folder: the second is reported", async () => {
    const third = join(dir, "third");
    await mkdir(third);
    await mkdir(root(), { recursive: true });
    await mkdir(target());
    const [, b, c] = await setAllRoots(app, root(), target(), third);
    await put("Same/a.stl", "solid");
    await mkdir(join(target(), "Same"));
    await writeFile(join(target(), "Same", "b.stl"), "solid");
    await scan();
    const all = await list();
    const first = all.find((p: { rootId: string }) => p.rootId !== b?.id);
    const second = all.find((p: { rootId: string }) => p.rootId === b?.id);

    const { moved, skipped } = (await relink([first.id, second.id], c?.id ?? "")).json();
    expect(moved.map((m: { id: string }) => m.id)).toEqual([first.id]);
    expect(skipped).toMatchObject([{ id: second.id, code: "folder_in_use" }]);
    await idle();
  });

  describe("with move", () => {
    const move = (ids: string[], rootId: string) =>
      app.inject({
        method: "POST",
        url: "/api/projects/relink",
        payload: { ids, rootId, move: true },
      });

    it("takes the files along, keeps plates, leaves no twin", async () => {
      const to = await twoRoots();
      await put("a/012_vase/vase.stl", "solid");
      await put("a/012_vase/images/cover.png", "png");
      await scan();
      const vase = await byName("vase");
      db.insert(schema.projectSlicePlates)
        .values({
          projectId: vase.id,
          file: "vase.stl",
          plate: 1,
          fileSize: 1,
          fileMtimeMs: 1,
          fileSha256: "x",
        })
        .run();

      expect((await move([vase.id], to)).json()).toEqual({
        moved: [{ id: vase.id, folderState: "ok" }],
        skipped: [],
      });
      await idle();
      await scan();

      const moved = join(target(), "a", "012_vase");
      expect((await stat(join(moved, "vase.stl"))).isFile()).toBe(true);
      expect((await stat(join(moved, "images", "cover.png"))).isFile()).toBe(true);
      await expect(stat(join(root(), "a", "012_vase"))).rejects.toThrow();
      expect(await detail(vase.id)).toMatchObject({
        rootId: to,
        folder: "a/012_vase",
        folderState: "ok",
        unlinkedFolder: null,
      });
      expect(db.select().from(schema.projectSlicePlates).all()).toHaveLength(1);
      expect(await list()).toHaveLength(1);
    });

    it("a name clash in the new folder moves nothing; the others go through", async () => {
      const to = await twoRoots();
      await put("Clash/same.stl", "old");
      await put("Clash/other.stl", "old");
      await put("Free/free.stl", "solid");
      await scan();
      const clash = await byName("Clash");
      const free = await byName("Free");
      await mkdir(join(target(), "Clash"));
      await writeFile(join(target(), "Clash", "same.stl"), "new");

      expect((await move([clash.id, free.id], to)).json()).toEqual({
        moved: [{ id: free.id, folderState: "ok" }],
        skipped: [{ id: clash.id, code: "folder_exists" }],
      });
      await idle();
      expect(await detail(clash.id)).toMatchObject({ rootId: clash.rootId, unlinkedFolder: null });
      expect((await stat(join(root(), "Clash", "other.stl"))).isFile()).toBe(true);
      await expect(stat(join(target(), "Clash", "other.stl"))).rejects.toThrow();
    });

    it("refuses a new root inside the project's folder, and leaves nothing behind", async () => {
      await put("Box/box.stl", "solid");
      await mkdir(join(root(), "Box", "inner"));
      const [, inner] = await setAllRoots(app, root(), join(root(), "Box", "inner"));
      await scan();
      const box = await byName("Box");
      expect((await move([box.id], inner?.id ?? "")).json().skipped).toEqual([
        { id: box.id, code: "invalid_folder" },
      ]);
      expect((await detail(box.id)).rootId).toBe(box.rootId);
      await expect(stat(join(root(), "Box", "inner", "Box"))).rejects.toThrow();
    });

    it("a folder already gone only changes the root", async () => {
      const to = await twoRoots();
      await put("Gone/g.stl", "solid");
      await scan();
      const gone = await byName("Gone");
      await rm(join(root(), "Gone"), { recursive: true });
      expect((await move([gone.id], to)).json().moved).toEqual([
        { id: gone.id, folderState: "missing" },
      ]);
      await idle();
      await expect(stat(join(target(), "Gone"))).rejects.toThrow();
    });
  });

  it("an unknown root is a 404, and an empty selection a 400", async () => {
    const to = await twoRoots();
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await relink([unknown], unknown)).statusCode).toBe(404);
    expect((await relink([], to)).statusCode).toBe(400);
  });
});

describe("project files and filters", () => {
  it("serves only listed model/image/doc files and plate previews", async () => {
    await sampleTree();
    await put("Benchy/secret.log", "nope");
    await setRoots();
    await scan();
    const { id, meta } = await byName("Benchy");
    const file = (q: Record<string, string>) =>
      app.inject(`/api/projects/${id}/file?${new URLSearchParams(q)}`);

    expect((await file({ path: "benchy.3mf" })).statusCode).toBe(200);
    // Docs too, so the description editor can load a file before it is linked.
    const readme = await file({ path: "README.md" });
    expect(readme.statusCode).toBe(200);
    expect(readme.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(readme.body).toContain("A tiny boat.");
    expect((await file({ path: "secret.log" })).statusCode).toBe(404); // not a listed kind
    expect((await file({ path: "../Vase/vase.stl" })).statusCode).toBe(404); // outside the folder

    const entry = meta.models[0].plates[0].thumbnail;
    const png = await file({ path: "benchy.3mf", entry });
    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect((await file({ path: "benchy.3mf", entry: "Metadata/other.png" })).statusCode).toBe(404);
  });

  it("filters the list by tag and collection", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const [benchy, vase] = [await byName("Benchy"), await byName("Vase")];
    const tag = (
      await app.inject({
        method: "POST",
        url: "/api/tags",
        payload: { name: "Gift", color: "#ff0000" },
      })
    ).json();
    await app.inject({
      method: "PUT",
      url: `/api/tags/taggings/project/${benchy.id}`,
      payload: { tagIds: [tag.id] },
    });
    const col = (
      await app.inject({ method: "POST", url: "/api/collections", payload: { name: "Boats" } })
    ).json();
    await app.inject({
      method: "PUT",
      url: `/api/collections/${col.id}/projects`,
      payload: { projectIds: [vase.id] },
    });
    const names = async (q: string) =>
      (await app.inject(`/api/projects?${q}`)).json().items.map((p: { name: string }) => p.name);
    expect(await names(`tagId=${tag.id}`)).toEqual(["Benchy"]);
    expect(await names(`collectionId=${col.id}`)).toEqual(["Vase"]);
  });
});

describe("open in slicer / folder", () => {
  const open = (id: string, payload: object) =>
    app.inject({ method: "POST", url: `/api/projects/${id}/open`, payload });

  it("only launches inside configured roots, listed files and with a slicer set", async () => {
    await sampleTree();
    await setRoots();
    await scan();
    const vase = await byName("Vase");

    // No slicer configured yet: no integration, then one without a program path.
    expect((await open(vase.id, { target: "slicer", file: "vase.stl" })).statusCode).toBe(409);
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: { adapterId: "slicer", secrets: { token: "t" } },
      })
    ).json();
    expect((await open(vase.id, { target: "slicer", file: "vase.stl" })).statusCode).toBe(409);
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: { slicerPath: process.execPath },
    });
    // Traversal and unlisted files are refused.
    for (const file of ["../Benchy/benchy.3mf", "../../x", "page.url", "nope.stl"])
      expect((await open(vase.id, { target: "slicer", file })).statusCode).toBe(403);
    // A listed model starts the program (node exits on the .stl; we only check it launched).
    expect((await open(vase.id, { target: "slicer", file: "vase.stl" })).json()).toEqual({
      ok: true,
    });
    // An explicit pick must be a usable slicer.
    const picked = (integrationId: string) =>
      open(vase.id, { target: "slicer", file: "vase.stl", integrationId });
    expect((await picked(id)).statusCode).toBe(200);
    expect((await picked(crypto.randomUUID())).statusCode).toBe(409);
    // Never on the server's screen for someone at another computer, or behind a proxy it can't see past.
    for (const from of [
      { remoteAddress: "192.0.2.7" },
      { headers: { "x-forwarded-for": "192.0.2.7" } },
    ]) {
      for (const payload of [{ target: "slicer", file: "vase.stl" }, { target: "folder" }]) {
        const res = await app.inject({
          method: "POST",
          url: `/api/projects/${vase.id}/open`,
          payload,
          ...from,
        });
        expect(res.json().error.code).toBe("not_local");
      }
    }

    // The root's folder gone -> nothing to open.
    await rename(root(), join(dir, "moved"));
    expect((await open(vase.id, { target: "folder" })).statusCode).toBe(403);
  });
});
