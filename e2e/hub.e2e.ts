import { expect, test } from "./fixtures.ts";

test("hub: change a connector's user with a code from the hub", async ({ page, app }) => {
  await page.goto("/");
  const post = async (path: string, data: object) =>
    (await page.request.post(path, { data })).json();
  const ana = await post("/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: "correct horse",
  });
  const anaId: string = ana.user?.id ?? ana.id;
  await post("/api/users", {
    displayName: "Ben Bench",
    email: "ben@example.com",
    password: "correct horse",
    roleId: "00000000-0000-4000-8000-000000000003",
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });

  // What the connector does: no session, only the code, then its token.
  const pairAna = async (name: string) => {
    const { code } = await post("/api/hub/pairing-codes", { userId: anaId });
    return app.api<{ token: string; deviceId: string }>("POST", "/api/hub/pair", { code, name });
  };
  const desk = await pairAna("Desk PC");
  const other = await pairAna("Other PC");
  const asDevice = (token: string, path: string, body?: object) =>
    fetch(`${app.url}${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body && JSON.stringify(body),
    });
  const whoIs = async () =>
    (await (await asDevice(desk.token, "/api/auth/me")).json()).user.displayName;

  // On the machine page: a code for anyone enabled but the current user.
  const newCode = async (user: string, current: string) => {
    await page.goto(`/hub/devices/${desk.deviceId}`);
    const identity = page.getByRole("region", { name: "Identity" });
    await expect(identity).toContainText(`User: ${current}`);
    await identity.getByRole("button", { name: "Change user" }).click();
    const dialog = page.getByRole("dialog", { name: "Change this connector's user" });
    await dialog.getByLabel("User").click();
    await expect(page.getByRole("option", { name: current })).toHaveCount(0);
    await page.getByRole("option", { name: user }).click();
    await dialog.getByRole("button", { name: "Create code" }).click();
    const shown = page.getByRole("dialog").filter({ hasText: "Code for Desk PC" });
    const code = (await shown.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/).textContent()) ?? "";
    await shown.getByRole("button", { name: "Done" }).click();
    await expect(shown).toBeHidden();
    return code;
  };

  const toBen = await newCode("Ben Bench", "Ana Admin");
  // Another device can't use it, and that doesn't use it up. Nothing has changed yet.
  const change = (token: string, code: string, projects: "move" | "stay") =>
    asDevice(token, "/api/hub/device/user", { code, projects });
  expect((await change(other.token, toBen, "move")).status).toBe(400);
  expect(await whoIs()).toBe("Ana Admin");

  const check = await asDevice(desk.token, "/api/hub/device/user/check", { code: toBen });
  expect(await check.json()).toEqual({
    userName: "Ben Bench",
    currentUserName: "Ana Admin",
    projects: 0,
  });
  expect((await change(desk.token, toBen, "stay")).status).toBe(200);
  expect(await whoIs()).toBe("Ben Bench");
  expect((await change(desk.token, toBen, "stay")).status).toBe(400); // used

  // The same token, no new pairing; both hub pages show it.
  await page.goto("/hub");
  const rows = page.getByRole("list", { name: "Devices" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Desk PC" })).toContainText("User: Ben Bench");
  await expect(rows.filter({ hasText: "Other PC" })).toContainText("User: Ana Admin");

  const back = await newCode("Ana Admin", "Ben Bench");
  expect((await change(desk.token, back, "move")).status).toBe(200);
  expect(await whoIs()).toBe("Ana Admin");
  await page.reload();
  await expect(page.getByRole("region", { name: "Identity" })).toContainText("User: Ana Admin");
});

test("hub: pair a device, edit it, revoke it", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });

  // Hub management is in the menu only while the hub is on.
  await page.reload();
  const nav = page.getByRole("link", { name: "Hub management" });
  await expect(nav).toHaveCount(0);
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  await page.reload();
  await nav.click();
  await expect(page.getByText("No devices yet")).toBeVisible();

  await page.getByRole("button", { name: "Pair a device" }).click();
  const pair = page.getByRole("dialog", { name: "Pair a device" });
  await pair.getByLabel("User").click();
  await page.getByRole("option", { name: "Ana Admin" }).click();
  await pair.getByRole("button", { name: "Create code" }).click();
  const shown = page.getByRole("dialog").filter({ hasText: "Pairing code" });
  const code = (await shown.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/).textContent()) ?? "";
  await shown.getByRole("button", { name: "Done" }).click();

  // What the connector does: no session, only the code.
  const { token } = await app.api<{ token: string }>("POST", "/api/hub/pair", {
    code,
    name: "Desk PC",
    os: "win32",
    connectorVersion: "5.0.0",
  });
  const asDevice = () =>
    fetch(`${app.url}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  expect((await asDevice()).status).toBe(200);
  // Online = its event stream is open, as a running connector holds it.
  const stream = new AbortController();
  const events = await fetch(`${app.url}/api/hub/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: stream.signal,
  });
  expect(events.status).toBe(200);

  await page.reload();
  const row = page.getByRole("list", { name: "Devices" }).getByRole("listitem");
  await expect(row).toContainText("Desk PC");
  await expect(row).toContainText("Online");
  await expect(row).toContainText("User: Ana Admin");
  await expect(row).toContainText("win32 · connector 5.0.0");

  // The card only links to the machine page (ADR-0021), where its actions are.
  await expect(row.getByRole("button")).toHaveCount(0);
  await row.getByRole("link", { name: "Desk PC" }).click();
  await expect(page.getByRole("heading", { name: "Desk PC" })).toBeVisible();
  await expect(page.getByText("Ana Admin · win32 · connector 5.0.0")).toBeVisible();

  // What the connector does with a live request: answer on /replies/:id.
  const reader = events.body?.getReader();
  const dec = new TextDecoder();
  void (async () => {
    let text = "";
    while (reader) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      text += dec.decode(value, { stream: true });
      for (const block of text.split("\n\n")) {
        const id = /"requestId":"([^"]+)"/.exec(block)?.[1];
        // Settings as a 5.5.0 connector; Stop as one before it, which doesn't know it.
        const answer = block.includes("connector.settings.get")
          ? { ok: true, result: { port: 4301, autostart: true, defaultSlicer: "" } }
          : block.includes("connector.stop")
            ? { ok: false, code: "ENOTSUP" }
            : null;
        if (!id || !answer) continue;
        text = "";
        await fetch(`${app.url}/api/hub/device/replies/${id}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(answer),
        });
      }
    }
  })();
  await expect(page.getByLabel("Local page port")).toHaveValue("4301");
  await expect(page.getByLabel("Start with the computer")).toBeChecked();

  const identity = page.getByRole("region", { name: "Identity" });
  await expect(identity).toContainText("User: Ana Admin");
  // Both pages follow a rename of the user.
  await page.request.patch("/api/auth/me", { data: { displayName: "Ana Renamed" } });
  await page.reload();
  await expect(identity).toContainText("User: Ana Renamed");
  await identity.getByLabel("Name").fill("Laptop");
  await identity.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Laptop" })).toBeVisible();

  // An older connector doesn't know Stop: the page says it's too old.
  const actions = page.getByRole("region", { name: "Actions" });
  await actions.getByRole("button", { name: "Stop connector" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Stop the connector on Laptop?" })
    .getByRole("button", { name: "Stop connector" })
    .click();
  await expect(actions.getByRole("alert")).toContainText("This connector is too old for this.");

  // Offline: what needs the connector says so, the hub-side settings stay editable.
  stream.abort();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText("Offline: changes apply when it reconnects.")).toBeVisible();
  await expect(
    page.getByText("The connector is offline. This can only be changed").first(),
  ).toBeVisible();
  await expect(actions.getByRole("button", { name: "Restart connector" })).toBeDisabled();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(row).toContainText("Laptop");
  await expect(row).toContainText("User: Ana Renamed");

  await row.getByRole("link", { name: "Laptop" }).click();
  const deviceId = page.url().split("/").pop();
  // Its slicer is installed from the slicer type's card in Integrations (ADR-0022): none found on
  // it, so the hub installs one. Not offered yet, it can't be the hub's slicer.
  await page.goto("/integrations");
  const card = page.getByRole("region", { name: "Bambu Studio" });
  await card.getByLabel("Add a machine…").click();
  await page.getByRole("option", { name: "Laptop" }).click();
  await expect(card.getByRole("heading", { name: "Laptop", level: 4 })).toBeVisible();
  await expect(card.getByText("Not offered: its user turns on Use as slicer")).toBeVisible();
  await expect(card.getByLabel("Change the hub's slicer…")).toHaveCount(0);
  // Offering it is the machine's, on its page.
  await page.goto(`/hub/devices/${deviceId}`);
  const slicers = page.getByRole("region", { name: "Slicers" });
  await expect(
    slicers.getByRole("switch", { name: /Use Bambu Studio on this machine/ }),
  ).toBeVisible();
  // Once per machine, from the API too.
  const again = await page.request.post("/api/integrations", {
    data: { adapterId: "bambu-studio-worker", config: { deviceId, source: "managed" } },
  });
  expect((await again.json()).error.code).toBe("slicer_exists");
  await actions.getByRole("button", { name: "Revoke" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Revoke Laptop?" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("No devices yet")).toBeVisible();
  expect((await asDevice()).status).toBe(401);
});

test("hub: a machine's own user edits only the sections their switches allow", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const post = async (path: string, data: object) =>
    (await page.request.post(path, { data })).json();
  await post("/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: "correct horse",
  });
  // A viewer, with the Catalog section of their own machines (and catalog write it needs).
  const ben = await post("/api/users", {
    displayName: "Ben Bench",
    email: "ben@example.com",
    password: "correct horse",
    roleId: "00000000-0000-4000-8000-000000000003",
    permissions: { "machine.catalog": true, catalog: "write" },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  const pair = async (userId: string, name: string) => {
    const { code } = await post("/api/hub/pairing-codes", { userId });
    return app.api<{ token: string; deviceId: string }>("POST", "/api/hub/pair", {
      code,
      name,
      os: "win32",
      connectorVersion: "5.5.0",
    });
  };
  const bens = await pair(ben.id, "Ben PC");
  const anas = await pair(
    (await (await page.request.get("/api/auth/me")).json()).user.id,
    "Ana PC",
  );
  // What its connector reports: the slicers it found.
  await fetch(`${app.url}/api/hub/device/slicers`, {
    method: "PUT",
    headers: { authorization: `Bearer ${bens.token}`, "content-type": "application/json" },
    body: JSON.stringify([{ id: "orca-slicer", version: "2.3.0", path: "C:/Orca/orca.exe" }]),
  });

  await page.context().clearCookies();
  await page.request.post("/api/auth/login", {
    data: { email: "ben@example.com", password: "correct horse" },
  });
  await page.goto(`/hub/devices/${bens.deviceId}`);
  await expect(page.getByRole("heading", { name: "Ben PC" })).toBeVisible();
  // System and User presets are theirs to change (ADR-0023); Projects and the actions are not.
  const share = page.getByRole("switch", { name: "Share OrcaSlicer user presets with the hub" });
  await expect(share).not.toBeChecked();
  await share.click({ force: true });
  await expect(share).toBeChecked();
  await expect(
    page.getByRole("switch", {
      name: "Receive the OrcaSlicer system presets, brands and printer models from the hub",
    }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Receive from the hub" })).toHaveCount(0);
  await expect(page.getByText("Receive from the hub: on")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Actions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change user" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Hub management" })).toHaveCount(0);
  // Not page-wide: the phone layout scrolls only down.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Someone else's machine isn't theirs to see.
  await page.goto(`/hub/devices/${anas.deviceId}`);
  await expect(page.getByText("This device doesn't exist anymore.")).toBeVisible();
});
