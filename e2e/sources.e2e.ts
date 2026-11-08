import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

for (const width of [375, 1440])
  test(`sources: the catalog source between two devices, Send presets per slicer (${width}px)`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.request.post("/api/auth/setup", {
      data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
    });
    await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
    // Nothing connected yet: each slicer still offers its zip, and the zip page comes back here.
    await page.goto("/catalog/sources");
    await expect(page.getByText("No slicer or account brings anything")).toBeVisible();
    const zip = page
      .getByRole("region", { name: "Bambu Studio", exact: true })
      .getByRole("region", { name: "No connector? Upload a zip" });
    await expect(zip).toContainText("on a computer that isn't connected");
    await zip.getByRole("link", { name: "Import from a slicer zip" }).click();
    await expect(page).toHaveURL(/\/import\/slicer-zip\?slicer=bambu-studio$/);
    await page.getByRole("link", { name: /back/i }).click();
    await expect(page).toHaveURL(/\/catalog\/sources$/);

    const me = await (await page.request.get("/api/auth/me")).json();
    /** A paired device that reports these slicers, as its connector does. */
    const pair = async (name: string, slicers: string[]) => {
      const { code } = await (
        await page.request.post("/api/hub/pairing-codes", { data: { userId: me.user.id } })
      ).json();
      const { token } = await app.api<{ token: string }>("POST", "/api/hub/pair", { code, name });
      const report = (ids: string[]) =>
        fetch(`${app.url}/api/hub/device/slicers`, {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(ids.map((id) => ({ id, version: "1", path: `C:/${id}.exe` }))),
        });
      expect((await report(slicers)).status).toBe(204);
      return report;
    };
    const ws1 = await pair("WS-1", ["bambu-studio", "orca-slicer"]);
    await pair("WS-2", ["bambu-studio"]);
    // A device is a catalog source only on a library with a worker row and no slicer of its own.
    const devices = await (await page.request.get("/api/hub/devices")).json();
    const wsId = (devices.items ?? devices).find((d: { name: string }) => d.name === "WS-1").id;
    await page.request.post("/api/integrations", {
      data: { adapterId: "bambu-studio-worker", config: { deviceId: wsId, source: "installed" } },
    });

    await page.goto("/catalog/sources");
    const studio = page.getByRole("region", { name: "Bambu Studio", exact: true });
    const orca = page.getByRole("region", { name: "OrcaSlicer", exact: true });

    // No install row reads the catalog: the first device does, until one is picked.
    const source = studio.getByRole("combobox", { name: "Read the catalog from" });
    await expect(source).toHaveValue(/^d:/);
    await expect(source.locator("option:checked")).toHaveText("WS-1 (connector)");
    await expect(studio.getByText("Picked for you")).toBeVisible();
    await source.selectOption({ label: "WS-2 (connector)" });
    await expect(studio.getByText("Picked for you")).toHaveCount(0);
    await expect(source.locator("option:checked")).toHaveText("WS-2 (connector)");
    await source.selectOption({ label: "WS-1 (connector)" });
    await expect(source.locator("option:checked")).toHaveText("WS-1 (connector)");

    // Send presets for one slicer of WS-1, not the other.
    const sendStudio = studio.getByRole("switch", { name: "Send Bambu Studio presets from WS-1" });
    const sendOrca = orca.getByRole("switch", { name: "Send OrcaSlicer presets from WS-1" });
    await sendStudio.click({ force: true });
    await expect(sendStudio).toBeChecked();
    await expect(sendOrca).not.toBeChecked();
    await expect(studio.getByRole("switch", { name: /from WS-2$/ })).not.toBeChecked();

    // A slicer WS-1 no longer reports keeps its row and values, greyed out.
    const installOrca = orca.getByRole("switch", { name: "Install presets in OrcaSlicer on WS-1" });
    await installOrca.click({ force: true });
    await expect(installOrca).toBeChecked();
    await ws1(["bambu-studio"]);
    await page.reload();
    await expect(orca.getByText("OrcaSlicer is no longer found on this device.")).toBeVisible();
    await expect(installOrca).toBeChecked();
    await expect(installOrca).toBeDisabled();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
