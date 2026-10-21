import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { mockAdapter } from "@3d-maker-suite/adapter-mock";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

const fixtures = join(import.meta.dirname, "../../../packages/3mf/fixtures");

let dir: string;
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
  app = await buildApp(openDb(":memory:"), false, join(dir, "data"), { adapters: [slicer] });
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
const setRoots = (projectScanDepth = 1) =>
  app.inject({
    method: "PATCH",
    url: "/api/preferences",
    payload: { projectRoots: [root()], projectScanDepth },
  });

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

    const benchy = await byName("Benchy");
    expect(benchy).toMatchObject({
      description: null, // readme text is not used unless linked
      sourceUrl: "https://www.printables.com/model/123-benchy",
      editedFields: [],
    });
    expect(benchy.meta.multicolor).toBe(true);
    expect(benchy.meta.models[0].plates.length).toBeGreaterThan(0);
    expect(benchy.meta.files.map((f: { path: string }) => f.path)).toContain("images/cover.png");
    expect(benchy.filePath).toBe(join(root(), "Benchy", "benchy.3mf"));
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
    const other = join(root(), "Boat", filePath.endsWith("a.stl") ? "b.stl" : "a.stl");

    expect((await patch({ previewFile: "../x.stl" })).statusCode).toBe(404);
    expect((await patch({ previewFile: "missing.stl" })).statusCode).toBe(404);
    const picked = (await patch({ previewFile: basename(other) })).json();
    expect(picked).toMatchObject({ filePath: other, editedFields: ["filePath"] });
    await scan();
    expect((await get()).filePath).toBe(other);

    await rm(other);
    await scan();
    expect((await get()).filePath).toBe(filePath);

    await put(basename(other) === "a.stl" ? "Boat/a.stl" : "Boat/b.stl", "solid");
    await patch({ previewFile: basename(other) });
    expect((await patch({ previewFile: null })).json().editedFields).toEqual([]);
  });

  it("reports roots that do not exist", async () => {
    await setRoots();
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
    await setRoots();
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

describe("project files and filters", () => {
  it("serves only listed model/image files and plate previews", async () => {
    await sampleTree();
    await put("Benchy/secret.log", "nope");
    await setRoots();
    await scan();
    const { id, meta } = await byName("Benchy");
    const file = (q: Record<string, string>) =>
      app.inject(`/api/projects/${id}/file?${new URLSearchParams(q)}`);

    expect((await file({ path: "benchy.3mf" })).statusCode).toBe(200);
    expect((await file({ path: "README.md" })).statusCode).toBe(404); // docs are not served
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

    // Roots removed -> the folder is no longer allowed.
    await app.inject({ method: "PATCH", url: "/api/preferences", payload: { projectRoots: [] } });
    expect((await open(vase.id, { target: "folder" })).statusCode).toBe(403);
  });
});
