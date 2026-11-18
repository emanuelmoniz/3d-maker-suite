import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openSources } from "./helpers.ts";

// 6.1.0 Step 18: what a machine gets from the server has its own tab, and each switch on the
// machine page links to the tab that sets it up.
for (const width of [375, 1440])
  test(`a machine's switches lead to its Sources and Consumers cards (${width}px)`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.request.post("/api/auth/setup", {
      data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
    });
    await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
    const me = await (await page.request.get("/api/auth/me")).json();
    const { code } = await (
      await page.request.post("/api/hub/pairing-codes", { data: { userId: me.user.id } })
    ).json();
    const { token, deviceId } = await app.api<{ token: string; deviceId: string }>(
      "POST",
      "/api/hub/pair",
      { code, name: "WS-1", os: "win32" },
    );
    // What its connector reports: Slicers catalog shows only with a slicer.
    await fetch(`${app.url}/api/hub/device/slicers`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([{ id: "orca-slicer", version: "2.3.0", path: "C:/Orca/orca.exe" }]),
    });

    await page.goto(`/hub/devices/${deviceId}`);
    const links = [
      ["Catalog consumers", `/catalog/settings/consumers#receive-${deviceId}`],
      ["Catalog sources", `/catalog/settings/sources#machine-${deviceId}`],
      ["Projects consumers", `/projects/settings/consumers#receive-${deviceId}`],
      ["Projects sources", `/projects/settings/sources#machine-${deviceId}`],
    ] as const;
    for (const [name, href] of links)
      await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    await expect(page.getByText("Sync sources configurations")).toHaveCount(0);
    expect(await hasHorizontalScroll(page)).toBe(false);

    // A switch off takes its own button away, and leaves the other one.
    const get = page.getByRole("switch", { name: "Get catalog from server" });
    await get.dispatchEvent("click");
    await expect(get).not.toBeChecked();
    await expect(page.getByRole("link", { name: "Catalog consumers" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Catalog sources" })).toBeVisible();
    await get.dispatchEvent("click");
    await expect(get).toBeChecked();

    // Its picks are on Consumers, its shared folders on Sources, with no card around either.
    await page.getByRole("link", { name: "Projects consumers" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/settings/consumers#receive-${deviceId}$`));
    await expect(page.locator(`#receive-${deviceId}`)).toContainText("No picks yet");
    await expect(page.getByRole("heading", { name: "Receive from server" })).toHaveCount(0);
    await page.goto("/projects/settings/sources");
    await openSources(page);
    await expect(page.locator(`#machine-${deviceId}`)).toContainText(
      "Its connector hasn't sent its shared folders yet.",
    );
    await expect(page.getByText("No picks yet")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Share to server" })).toHaveCount(0);

    // The catalog's consumers left its Sources tab.
    await page.goto("/catalog/settings/consumers");
    await openSources(page);
    await expect(page.locator(`#receive-${deviceId}`)).toContainText("OrcaSlicer");
    await page.goto("/catalog/settings/sources");
    await expect(page.locator(`#receive-${deviceId}`)).toHaveCount(0);
  });

test("with the hub off, only Catalog has a Consumers tab", async ({ page }) => {
  await page.goto("/projects/settings");
  await expect(page.getByRole("link", { name: "Sources", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Consumers", exact: true })).toHaveCount(0);
  await page.goto("/projects/settings/consumers");
  await expect(page).toHaveURL(/\/projects\/settings$/);

  await page.goto("/catalog/settings");
  await page.getByRole("link", { name: "Consumers", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog\/settings\/consumers$/);
  await expect(page.getByRole("heading", { name: "No consumers yet" })).toBeVisible();
});
