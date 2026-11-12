import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    // Nothing connected yet: Sources still offers each slicer's zip, and the zip page comes back there.
    await page.goto("/catalog/settings/sources");
    await openSources(page);
    const zip = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "No connector? Upload a zip" }) })
      .getByRole("region", { name: "Bambu Studio", exact: true });
    await expect(zip).toContainText("on a computer that isn't connected");
    await zip.getByRole("link", { name: "Import from a slicer zip" }).click();
    await expect(page).toHaveURL(/\/import\/slicer-zip\?slicer=bambu-studio$/);
    await page.getByRole("link", { name: /back/i }).click();
    await expect(page).toHaveURL(/\/catalog\/settings\/sources$/);

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
    // The hub's slicer (ADR-0022): an install on a machine; the first one, until one is picked in
    // Integrations. It is the catalog source.
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
    await worker("WS-2");
    await page.goto("/catalog/settings/sources");
    await openSources(page);
    const share1 = block(page, "Share to the hub", "WS-1");
    const share2 = block(page, "Share to the hub", "WS-2");
    const hubSlicer = (b: typeof share1) => b.getByText("The hub's slicer", { exact: true });
    await expect(hubSlicer(share1)).toBeVisible();
    // Every machine with the slicer is listed for its user presets; only the hub's slicer shares
    // the catalog.
    await expect(share2).toBeVisible();
    await expect(hubSlicer(share2)).toHaveCount(0);
    // Picked in Integrations: Change slicer machine, below the hub's slicer's panel, asks first.
    await page.goto("/integrations");
    const card = page.getByRole("region", { name: "Bambu Studio" });
    await card.getByRole("button", { name: "Change slicer machine" }).click();
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "Change the Bambu Studio slicer machine" });
    await dialog.getByLabel("Slicer machine").click();
    await page.getByRole("option", { name: /^WS-2/ }).click();
    const picked = page.waitForResponse((r) =>
      r.url().endsWith("/api/integrations/slicers/bambu-studio"),
    );
    await dialog.getByRole("button", { name: "Make it the hub's slicer" }).click();
    expect((await picked).status()).toBe(204);
    await page.goto("/catalog/settings/sources");
    await openSources(page);
    await expect(hubSlicer(share2)).toBeVisible();
    await expect(hubSlicer(share1)).toHaveCount(0);
    // Its heading says where it is changed.
    await expect(share2.getByRole("link", { name: "Change in Integrations" })).toHaveAttribute(
      "href",
      "/integrations#library-bambu-studio",
    );

    // Receive from the hub: every machine with the slicer, its System and User presets lines on one
    // card. The hub's slicer receives user presets only: its own folder is the catalog.
    const receive2 = block(page, "Receive from the hub", "WS-2");
    await expect(receive2.getByText("The hub's slicer", { exact: true })).toBeVisible();
    await expect(receive2.getByRole("switch", { name: /Receive the system presets/ })).toHaveCount(
      0,
    );
    await expect(
      receive2.getByRole("switch", { name: "Receive user presets in Bambu Studio on WS-2" }),
    ).toBeVisible();
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
    await expect(
      receive1.getByRole("switch", { name: "Receive user presets in Bambu Studio on WS-1" }),
    ).not.toBeChecked();
    await page.reload();
    await openSources(page);
    await expect(system).toBeChecked();
    await system.dispatchEvent("click");
    await expect(system).not.toBeChecked();

    // WS-1 shares Bambu Studio's filament presets and nothing else: a kind on turns Share on.
    // OrcaSlicer is listed too, every kind off.
    const shares = block(page, "Share to the hub", "WS-1");
    const kindLine = (kind: string, slicer = "Bambu Studio") =>
      shares.getByRole("switch", { name: `Share ${kind} from ${slicer} on WS-1` });
    for (const kind of ["Printer presets", "Process presets", "Filament presets"])
      await expect(kindLine(kind)).not.toBeChecked();
    // On the switch itself: a forced click at phone width can land on the bottom bar.
    await kindLine("Filament presets").dispatchEvent("click");
    await expect(kindLine("Filament presets")).toBeChecked();
    await expect(kindLine("Printer presets")).not.toBeChecked();
    await expect(kindLine("Filament presets", "OrcaSlicer")).not.toBeChecked();
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

    // This server's own install receives user presets too (5.5.0 Step 11i). Its own folder: never
    // this computer's real slicer.
    const { id: local } = await (
      await page.request.post("/api/integrations", { data: { adapterId: "bambu-studio" } })
    ).json();
    await page.request.patch(`/api/integrations/${local}`, {
      data: { slicerConfigDir: mkdtempSync(join(tmpdir(), "e2e-receive-")) },
    });
    await page.reload();
    await openSources(page);
    const server = page
      .getByRole("region", { name: "Receive from the hub", exact: true })
      .locator("#receive-server");
    const userLine = server.getByRole("switch", {
      name: "Receive user presets in Bambu Studio on This server",
    });
    await expect(userLine).not.toBeChecked();
    await userLine.dispatchEvent("click");
    await expect(userLine).toBeChecked();
    expect(
      (await (await page.request.get(`/api/integrations/${local}`)).json()).presetReceive,
    ).toBe(true);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
