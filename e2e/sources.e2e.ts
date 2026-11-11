import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openSources } from "./helpers.ts";

/** A machine's block in a section of a Sources tab: its heading names it. */
const block = (page: Page, section: string, machine: string) =>
  page
    .getByRole("region", { name: section, exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: machine, exact: true, level: 3 }) });

for (const width of [375, 1440])
  test(`sources: the hub's slicer between two machines, one slicer's filament presets (${width}px)`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.request.post("/api/auth/setup", {
      data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
    });
    await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
    // Nothing connected yet: Catalog has no source, Presets still offers each slicer's zip, and
    // the zip page comes back there.
    await page.goto("/catalog/settings/sources");
    await expect(page.getByRole("heading", { name: "No sources" })).toBeVisible();
    await page.goto("/presets/settings/sources");
    await openSources(page);
    const zip = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "No connector? Upload a zip" }) })
      .getByRole("region", { name: "Bambu Studio", exact: true });
    await expect(zip).toContainText("on a computer that isn't connected");
    await zip.getByRole("link", { name: "Import from a slicer zip" }).click();
    await expect(page).toHaveURL(/\/import\/slicer-zip\?slicer=bambu-studio$/);
    await page.getByRole("link", { name: /back/i }).click();
    await expect(page).toHaveURL(/\/presets\/settings\/sources$/);

    const me = await (await page.request.get("/api/auth/me")).json();
    /** A paired machine that reports these slicers, as its connector does. */
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
    const devices = await (await page.request.get("/api/hub/devices")).json();
    const idOf = (name: string) =>
      (devices.items ?? devices).find((d: { name: string }) => d.name === name).id as string;
    /** A machine page switch, as its Slicers section sends it. */
    const set = async (name: string, library: string, data: object) =>
      expect(
        (
          await page.request.patch(`/api/hub/devices/${idOf(name)}/slicers/${library}`, { data })
        ).status(),
      ).toBe(204);
    // The hub's slicer (ADR-0022): an install on a machine that offers it (Use as slicer); the first
    // one, until one is picked in Integrations. It is the catalog source.
    const worker = async (name: string) =>
      (
        await page.request.post("/api/integrations", {
          data: {
            adapterId: "bambu-studio-worker",
            config: { deviceId: idOf(name), source: "installed" },
          },
        })
      ).json();
    await worker("WS-1");
    const w2 = await worker("WS-2");
    await page.goto("/catalog/settings/sources");
    const share1 = block(page, "Share to the hub", "WS-1");
    const share2 = block(page, "Share to the hub", "WS-2");
    await expect(share1).toHaveCount(0);
    await set("WS-1", "bambu-studio", { slicer: true });
    await set("WS-2", "bambu-studio", { slicer: true });
    await page.reload();
    await openSources(page);
    await expect(share1.getByText("The hub's slicer", { exact: true })).toBeVisible();
    // Only the hub's slicer shares the catalog: another machine with it isn't listed.
    await expect(share2).toHaveCount(0);
    expect(
      (
        await page.request.put("/api/integrations/slicers/bambu-studio", {
          data: { integrationId: w2.id },
        })
      ).status(),
    ).toBe(204);
    await page.reload();
    await openSources(page);
    await expect(share2.getByText("The hub's slicer", { exact: true })).toBeVisible();
    await expect(share1).toHaveCount(0);
    // Its heading says where it is changed.
    await expect(share2.getByRole("link", { name: "Change in Integrations" })).toHaveAttribute(
      "href",
      "/integrations#library-bambu-studio",
    );

    // Receive from the hub: every machine with the slicer but the hub's slicer, from either tab.
    await expect(block(page, "Receive from the hub", "WS-2")).toHaveCount(0);
    const catalogLine =
      "Receive the system presets, brands and printer models in Bambu Studio on WS-1";
    const receive1 = block(page, "Receive from the hub", "WS-1");
    const system = receive1.getByRole("switch", { name: catalogLine });
    await expect(system).not.toBeChecked();
    await expect(receive1.getByText("Offline", { exact: true })).toBeVisible();
    await system.dispatchEvent("click");
    await expect(system).toBeChecked();
    const sources = await (await page.request.get("/api/catalog/sources")).json();
    expect(
      sources
        .find((l: { library: string }) => l.library === "bambu-studio")
        .machines.find((m: { name: string }) => m.name === "WS-1"),
    ).toMatchObject({ receive: true });
    await page.goto("/presets/settings/sources");
    await openSources(page);
    const onPresets = block(page, "Receive from the hub", "WS-1").getByRole("switch", {
      name: catalogLine,
    });
    await expect(onPresets).toBeChecked();
    await onPresets.dispatchEvent("click");
    await expect(onPresets).not.toBeChecked();

    // WS-1 shares Bambu Studio's filament presets and nothing else; OrcaSlicer stays off.
    await set("WS-1", "bambu-studio", { user: { share: true } });
    await page.goto("/presets/settings/sources");
    await openSources(page);
    const shares = block(page, "Share to the hub", "WS-1");
    for (const kind of ["Printer presets", "Process presets"]) {
      const line = shares.getByRole("switch", { name: `Share ${kind} from Bambu Studio on WS-1` });
      // On the switch itself: a forced click at phone width can land on the bottom bar.
      await line.dispatchEvent("click");
      await expect(line).not.toBeChecked();
    }
    await expect(
      shares.getByRole("switch", { name: "Share Filament presets from Bambu Studio on WS-1" }),
    ).toBeChecked();
    await expect(shares.getByRole("region", { name: "OrcaSlicer", exact: true })).toHaveCount(0);
    const [device] = (await (await page.request.get("/api/presets/devices")).json()).filter(
      (d: { name: string }) => d.name === "WS-1",
    );
    expect(device.libraries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          library: "bambu-studio",
          send: true,
          shareKinds: ["filament"],
        }),
      ]),
    );

    // A slicer WS-1 no longer reports keeps its lines and values, which can't change.
    await set("WS-1", "orca-slicer", { user: { receive: true } });
    await ws1(["bambu-studio"]);
    await page.reload();
    await openSources(page);
    const receives = block(page, "Receive from the hub", "WS-1");
    await expect(
      receives.getByText("OrcaSlicer is no longer found on this machine."),
    ).toBeVisible();
    const filament = receives.getByRole("switch", {
      name: "Receive user presets in OrcaSlicer on WS-1",
    });
    await expect(filament).toBeChecked();
    await expect(filament).toBeDisabled();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
