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

  await page.goto("/presets/settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Library" })
    .click();
  await expect(page).toHaveURL(/\/presets\/settings\/library$/);
  await page.goto("/hub/presets");
  await expect(page).toHaveURL(/\/presets\/settings\/library$/);
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
  await expect(confirm).toContainText("every device with Install on");
  await confirm.getByRole("button", { name: "Delete preset" }).click();
  await expect(page.getByText("No preset of this type has that in its name.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Find a preset" }).fill("");
  await expect(page.getByRole("button", { name: "Filament (1)" })).toBeVisible();

  // Restore (ADR-0019): from the deleted list, as its next version.
  await page.getByText("1 deleted preset").click();
  await page.getByRole("button", { name: "Restore Silk" }).click();
  await expect(page.getByRole("button", { name: "Filament (2)" })).toBeVisible();
  await expect(page.getByText("1 deleted preset")).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 800 });
  expect(await hasHorizontalScroll(page)).toBe(false);
});

test("slicer presets without hub.manage: an editor's switches, a viewer's list, hub off hides it", async ({
  page,
  app,
}) => {
  const PASSWORD = "correct horse";
  const signInAs = async (email: string) => {
    await page.context().clearCookies();
    expect(
      (await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } })).ok(),
    ).toBe(true);
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: PASSWORD },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  // The seeded roles (migration 0086).
  for (const [displayName, email, roleId] of [
    ["Eva Editor", "eva@example.com", "00000000-0000-4000-8000-000000000002"],
    ["Vic Viewer", "vic@example.com", "00000000-0000-4000-8000-000000000003"],
  ])
    expect(
      (
        await page.request.post("/api/users", {
          data: { displayName, email, password: PASSWORD, roleId },
        })
      ).ok(),
    ).toBe(true);
  const zip = await zipOf({ "user/default/filament/Farm PLA.json": { name: "Farm PLA" } });
  await page.request.post("/api/slicer-zip/orca-slicer", {
    headers: { "content-type": "application/zip" },
    data: zip,
  });
  const me = await (await page.request.get("/api/auth/me")).json();
  const { code } = await (
    await page.request.post("/api/hub/pairing-codes", { data: { userId: me.user.id } })
  ).json();
  const { token } = await app.api<{ token: string }>("POST", "/api/hub/pair", {
    code,
    name: "Desk PC",
  });
  const device = (method: string, path: string, body: unknown) =>
    fetch(`${app.url}/api/hub/device${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  await device("PUT", "/slicers", [
    { id: "orca-slicer", version: "2.5", path: "C:/Orca/orca-slicer.exe", default: true },
  ]);
  const side = page.getByRole("complementary");
  const tabs = page.getByRole("navigation", { name: "Settings sections" });
  const tab = tabs.getByRole("link", { name: "Library" });
  // ADR-0021: Presets → its settings → Library, open to `presets` read.
  const openPresets = async () => {
    await side.getByRole("link", { name: "Presets" }).click();
    await page.getByRole("link", { name: "Presets settings" }).click();
    await tab.click();
  };

  // Editor: from the navigation.
  await signInAs("eva@example.com");
  await page.goto("/");
  await expect(side.getByRole("link", { name: "Hub management" })).toHaveCount(0);
  await openPresets();
  await expect(page.getByText("Farm PLA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Farm PLA" })).toBeVisible();
  // The switches are per slicer, in Sources (ADR-0020).
  await expect(page.getByRole("switch")).toHaveCount(0);
  await tabs.getByRole("link", { name: "Sources" }).click();
  const install = page.getByRole("switch", { name: "Install presets in OrcaSlicer on Desk PC" });
  await expect(install).not.toBeChecked();
  expect((await device("GET", "/presets", undefined)).status).toBe(403);
  await install.click({ force: true });
  await expect(install).toBeChecked();

  // What the connector reports shows in the device's row.
  expect(
    (
      await device("PUT", "/presets/install", [
        {
          library: "orca-slicer",
          folder: "C:/Users/me/AppData/Roaming/OrcaSlicer/user/abc",
          waiting: true,
          queued: 1,
          queue: [{ library: "orca-slicer", kind: "filament", name: "Farm PLA" }],
          backup: null,
          editsStayLocal: true,
        },
      ])
    ).status,
  ).toBe(204);
  await page.reload();
  const row = page.getByRole("row", { name: /Desk PC/ });
  await expect(row.getByText("1 preset waits for this slicer to close:")).toBeVisible();
  await expect(row.getByRole("list", { name: "Presets waiting for OrcaSlicer" })).toContainText(
    "Farm PLA",
  );
  await expect(row.getByText("An edit from the hub stays on this PC")).toBeVisible();
  await row.getByText("Folder and backup").click();
  await expect(
    row.getByText("Writes to C:/Users/me/AppData/Roaming/OrcaSlicer/user/abc"),
  ).toBeVisible();
  await expect(row.getByText("No backup yet.")).toBeVisible();

  // Viewer: sees the presets and Sources, without the switches or delete.
  await signInAs("vic@example.com");
  await page.goto("/");
  await openPresets();
  await expect(page.getByText("Farm PLA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Farm PLA" })).toHaveCount(0);
  await page.goto("/presets/settings/sources");
  await expect(page.getByRole("heading", { name: "OrcaSlicer" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  const patch = { data: { library: "orca-slicer", send: true } };
  expect((await page.request.patch("/api/presets/devices/x", patch)).status()).toBe(403);

  // The machine page has the same switch, and a link to the rest of the presets' settings.
  await signInAs("ana@example.com");
  const [{ id }] = await (await page.request.get("/api/presets/devices")).json();
  await page.goto(`/hub/devices/${id}`);
  await expect(
    page.getByRole("switch", { name: "Receive OrcaSlicer presets from the hub" }),
  ).toBeChecked();
  await page.getByRole("link", { name: "Presets settings" }).click();
  await expect(page).toHaveURL(/\/presets\/settings\/sources#devices-orca-slicer$/);

  // Hub off: hidden for all.
  await page.request.patch("/api/preferences", { data: { hubEnabled: false } });
  await signInAs("eva@example.com");
  await page.goto("/presets/settings");
  await expect(tabs.getByRole("link", { name: "Sources" })).toBeVisible();
  await expect(tab).toHaveCount(0);
  await page.goto("/catalog/presets");
  await expect(page).toHaveURL(/\/presets\/settings$/);
});

test("share my presets: the switch, a device's preset, a conflict copy, a desktop delete", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // No page before setup: its auth check could answer after it and redirect a later goto to login.
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

  await page.goto("/catalog/presets");
  await expect(page.getByText("No slicer presets yet")).toBeVisible();
  await page.goto("/presets/settings/sources");
  const toggle = page.getByRole("switch", { name: "Send Bambu Studio presets from Desk PC" });
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
  await expect(page.getByRole("row", { name: /Desk PC/ })).toContainText("Last sent");
  await page.goto("/catalog/presets");
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

  // Today's connector (ADR-0019): its user's presets, more at once than the limit, wait for a person.
  await page.request.patch("/api/preferences", { data: { hubDeleteGuard: 1 } });
  const silk = await device("PUT", "/presets", {
    library: "bambu-studio",
    kind: "filament",
    name: "Silk",
    base: 0,
    text: JSON.stringify({ name: "Silk" }),
  });
  expect(silk.status).toBe(200);
  const removals = await device("POST", "/presets/removals", {
    library: "bambu-studio",
    account: "default",
    removed: [
      { kind: "filament", name: "Farm PLA" },
      { kind: "filament", name: "Silk" },
    ],
  });
  expect((await removals.json()).map((r: { result: string }) => r.result)).toEqual([
    "held",
    "held",
  ]);
  await page.reload();
  await expect(
    page.getByText("Desk PC removed 2 slicer presets at once; they stay until someone deletes"),
  ).toBeVisible();
  await page.goto("/catalog/presets");
  const held = page.getByRole("region", { name: "Deletes waiting for you" });
  await expect(held).toContainText("Desk PC removed 2 presets at once");
  await expect(row).toContainText("Removed on Desk PC with many others at once");
  await held.getByRole("button", { name: "Delete the presets removed on Desk PC" }).click();
  await expect(held).toHaveCount(0);
  await expect(page.getByText("2 deleted presets")).toBeVisible();
});
