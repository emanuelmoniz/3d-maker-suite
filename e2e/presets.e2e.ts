import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

// yazl is the server's dependency (it reads the zips); the tests only borrow it to build one.
const yazl = createRequire(join(import.meta.dirname, "..", "apps", "server", "package.json"))(
  "yazl",
) as typeof import("yazl");

const zipOf = (files: Record<string, unknown>) =>
  new Promise<Buffer>((resolve) => {
    const z = new yazl.ZipFile();
    for (const [name, data] of Object.entries(files))
      z.addBuffer(Buffer.from(JSON.stringify(data)), name);
    const chunks: Buffer[] = [];
    z.outputStream.on("data", (c: Buffer) => chunks.push(c));
    z.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    z.end();
  });

test("hub presets: two PCs' zips in one library, versions, delete", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  const upload = async (files: Record<string, unknown>) =>
    expect(
      (
        await page.request.post("/api/slicer-zip/orca-slicer", {
          headers: { "content-type": "application/zip" },
          data: await zipOf(files),
        })
      ).status(),
    ).toBe(200);
  await upload({
    "user/123/filament/Farm PLA.json": { name: "Farm PLA", inherits: "Generic PLA" },
    "user/123/process/Fast.json": { name: "Fast" },
  });
  await upload({
    "user/default/filament/Farm PLA.json": {
      name: "Farm PLA",
      inherits: "Generic PLA",
      filament_cost: ["21"],
    },
    "user/default/filament/Silk.json": { name: "Silk" },
  });

  await page.goto("/hub");
  await page.getByRole("link", { name: "Slicer presets" }).click();
  await expect(page.getByRole("heading", { name: "Slicer presets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filament (2)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  const farm = rows.filter({ hasText: "Farm PLA" });
  await expect(farm).toContainText("Based on Generic PLA");
  await expect(farm).toContainText("Version 2, saved");
  await expect(farm).toContainText("by Ana Admin");

  // Its earlier version, from the first zip.
  await farm.getByRole("button", { name: /^Farm PLA/ }).click();
  const versions = page.getByRole("list", { name: "Earlier versions of Farm PLA" });
  await expect(versions.getByRole("listitem")).toHaveCount(1);
  await expect(versions).toContainText("Version 1, saved");
  await expect(versions.getByRole("link", { name: "Download version 1" })).toHaveAttribute(
    "href",
    /download\?version=1$/,
  );

  await page.getByRole("button", { name: "Process (1)" }).click();
  await expect(rows).toHaveText([/Fast/]);
  await page.getByRole("button", { name: /Filament/ }).click();
  await page.getByRole("searchbox", { name: "Find a preset" }).fill("silk");
  await expect(rows).toHaveText([/Silk/]);

  await page.getByRole("button", { name: "Delete Silk" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Delete Silk?" });
  await expect(confirm).toContainText("Workstations keep their own copy");
  await confirm.getByRole("button", { name: "Delete preset" }).click();
  await expect(page.getByText("No preset of this type has that in its name.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Find a preset" }).fill("");
  await expect(page.getByRole("button", { name: "Filament (1)" })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 800 });
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test("share my presets: the switch, a device's preset, a conflict copy, a desktop delete", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  const me = await (await page.request.get("/api/auth/me")).json();
  const { code } = await (
    await page.request.post("/api/hub/pairing-codes", { data: { userId: me.user.id } })
  ).json();
  const { token } = await app.api<{ token: string }>("POST", "/api/hub/pair", {
    code,
    name: "Desk PC",
  });
  // What the connector does, with its device token.
  const device = (method: string, path: string, body: unknown) =>
    fetch(`${app.url}/api/hub/device${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const slicers = await device("PUT", "/slicers", [
    { id: "bambu-studio", version: "1", path: "C:/Studio/bambu-studio.exe", default: true },
  ]);
  expect(slicers.status).toBe(204);

  await page.goto("/hub/presets");
  await expect(page.getByText("No slicer presets yet")).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Share my presets on Desk PC" });
  await expect(toggle).not.toBeChecked();
  const preset = (cost: string) =>
    device("PUT", "/presets", {
      library: "bambu-studio",
      kind: "filament",
      name: "Farm PLA",
      base: 1,
      text: JSON.stringify({ name: "Farm PLA", filament_cost: [cost] }),
    });
  expect((await preset("20")).status).toBe(403);
  await toggle.click({ force: true });
  await expect(toggle).toBeChecked();

  // New, then the next version from base 1, then a stale edit, still from base 1.
  for (const cost of ["20", "21", "22"]) expect((await preset(cost)).status).toBe(200);
  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: /^Farm PLA(?! \()/ });
  await expect(row).toContainText("Version 2, saved");
  await expect(row).toContainText("by Ana Admin on Desk PC");
  const conflicts = page.getByRole("region", { name: "1 conflict copy" });
  await expect(conflicts).toContainText("Farm PLA (conflict Desk PC");

  const removed = await device("POST", "/presets/removed", {
    library: "bambu-studio",
    kind: "filament",
    name: "Farm PLA",
  });
  expect(removed.status).toBe(204);
  await page.reload();
  await expect(row).toContainText("Removed on Desk PC");

  await page.goto("/alerts");
  await expect(
    page.getByText(/Slicer preset Farm PLA changed on the hub and on Desk PC/),
  ).toBeVisible();
});
