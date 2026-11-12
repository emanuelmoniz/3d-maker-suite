import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openSources } from "./helpers.ts";

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

  await page.goto("/catalog/settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Library" })
    .click();
  await expect(page).toHaveURL(/\/catalog\/settings\/library$/);
  await page.goto("/hub/presets");
  await expect(page).toHaveURL(/\/catalog\/settings\/library$/);
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
  // ADR-0023: Catalog → its settings → Library, open to `catalog` read.
  const openPresets = async () => {
    await side.getByRole("link", { name: "Catalog" }).click();
    await page.getByRole("link", { name: "Catalog settings" }).click();
    await tab.click();
  };

  // Receive is the machine's switch on Catalog settings → Sources (ADR-0023); its owner, here the
  // admin, turns it on.
  expect((await device("GET", "/presets", undefined)).status).toBe(403);
  const [{ id }] = await (await page.request.get("/api/presets/devices")).json();
  const slicer = `/api/hub/devices/${id}/slicers/orca-slicer`;
  const receive = { data: { user: { receive: true } } };
  expect((await page.request.patch(slicer, receive)).status()).toBe(204);
  expect((await device("GET", "/presets", undefined)).status).toBe(200);
  // What the connector reports shows on the machine's lines.
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

  // Editor: from the navigation; sees the machine's lines, which aren't theirs to switch.
  await signInAs("eva@example.com");
  await page.goto("/");
  await expect(side.getByRole("link", { name: "Hub management" })).toHaveCount(0);
  await openPresets();
  await expect(page.getByText("Farm PLA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Farm PLA" })).toBeVisible();
  await tabs.getByRole("link", { name: "Sources" }).click();
  await openSources(page);
  const machine = page
    .getByRole("region", { name: "Receive from server" })
    .getByRole("region", { name: "OrcaSlicer", exact: true });
  // One User presets line for every kind (ADR-0023); no switch without the machine's right.
  await expect(machine.getByRole("row", { name: /User presets/ })).toContainText(
    "1 waiting for the slicer to close",
  );
  await expect(
    machine.getByRole("switch", { name: "Receive user presets in OrcaSlicer on Desk PC" }),
  ).toHaveCount(0);
  await expect(machine.getByRole("list", { name: "Presets waiting for OrcaSlicer" })).toContainText(
    "Farm PLA",
  );
  await expect(machine.getByText("An edit from the hub stays on this PC")).toBeVisible();
  // Its `⋯`: where it writes and the last backup.
  await machine.getByLabel("More for User presets in OrcaSlicer on Desk PC").click();
  await page.getByRole("button", { name: "What is received" }).click();
  const details = page.getByRole("dialog", { name: "User presets in OrcaSlicer on Desk PC" });
  await expect(
    details.getByText("Writes to C:/Users/me/AppData/Roaming/OrcaSlicer/user/abc"),
  ).toBeVisible();
  await expect(details.getByText("No backup yet.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Viewer: sees the presets and Sources, without the switches or delete.
  await signInAs("vic@example.com");
  await page.goto("/");
  await openPresets();
  await expect(page.getByText("Farm PLA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Farm PLA" })).toHaveCount(0);
  await page.goto("/catalog/settings/sources");
  await expect(page.getByRole("switch")).toHaveCount(0);
  // Someone else's machine is as unknown as a missing one.
  expect((await page.request.patch(slicer, receive)).status()).toBe(404);

  // The machine page lists its slicer with no switches, and links to its card on Catalog
  // settings → Sources, where they are.
  await signInAs("ana@example.com");
  await page.goto(`/hub/devices/${id}`);
  const slicers = page.getByRole("region", { name: "Slicers" });
  await expect(slicers.getByText("OrcaSlicer", { exact: true })).toBeVisible();
  await expect(slicers.getByRole("switch")).toHaveCount(0);
  await slicers
    .getByRole("region", { name: "Sync sources configurations" })
    .getByRole("link", { name: "Catalog" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/catalog/settings/sources#machine-${id}$`));
  await expect(
    page.getByRole("switch", { name: "Receive user presets in OrcaSlicer on Desk PC" }),
  ).toBeChecked();

  // Hub off: hidden for all.
  await page.request.patch("/api/preferences", { data: { hubEnabled: false } });
  await signInAs("eva@example.com");
  await page.goto("/catalog/settings");
  await expect(tabs.getByRole("link", { name: "Sources", exact: true })).toBeVisible();
  await expect(tab).toHaveCount(0);
  await page.goto("/catalog/presets");
  await expect(page).toHaveURL(/\/catalog\/settings$/);
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
  const preset = (cost: string) =>
    device("PUT", "/presets", {
      library: "bambu-studio",
      kind: "filament",
      name: "Farm PLA",
      base: 1,
      text: JSON.stringify({ name: "Farm PLA", filament_cost: [cost] }),
    });
  expect((await preset("20")).status).toBe(403);
  // Share is on while a kind is, on Catalog settings → Sources (ADR-0021).
  const [{ id }] = await (await page.request.get("/api/presets/devices")).json();
  const share = { data: { user: { share: true } } };
  expect(
    (await page.request.patch(`/api/hub/devices/${id}/slicers/bambu-studio`, share)).status(),
  ).toBe(204);

  // New, then the next version from base 1, then a stale edit, still from base 1.
  for (const cost of ["20", "21", "22"]) expect((await preset(cost)).status).toBe(200);
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

  // A short title; the alert itself says what was kept.
  await page.goto("/alerts");
  await page.getByRole("link", { name: "Slicer preset Farm PLA changed", exact: true }).click();
  await expect(
    page.getByText(/^It changed on the hub and on Desk PC\. Their version/),
  ).toBeVisible();
  await page.goto("/alerts");

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
    page.getByRole("link", { name: "Desk PC removed 2 slicer presets at once", exact: true }),
  ).toBeVisible();
  await page.goto("/catalog/presets");
  const held = page.getByRole("region", { name: "Deletes waiting for you" });
  await expect(held).toContainText("Desk PC removed 2 presets at once");
  await expect(row).toContainText("Removed on Desk PC with many others at once");
  await held.getByRole("button", { name: "Delete the presets removed on Desk PC" }).click();
  await expect(held).toHaveCount(0);
  await expect(page.getByText("2 deleted presets")).toBeVisible();
});
