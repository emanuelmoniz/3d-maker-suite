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

  // On the Edit connector page: a code for anyone enabled but the current user.
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

  // The card has only the two connector actions; everything else is on the Edit connector page.
  await expect(row.getByRole("button")).toHaveText(["Restart connector", "Revoke"]);
  await row.getByRole("link", { name: "Desk PC" }).click();
  await expect(page.getByRole("heading", { name: "Edit connector: Desk PC" })).toBeVisible();

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
        if (!id || !block.includes("connector.settings.get")) continue;
        text = "";
        await fetch(`${app.url}/api/hub/device/replies/${id}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ ok: true, result: { port: 4301, autostart: true } }),
        });
      }
    }
  })();
  await expect(page.getByLabel("Status page port")).toHaveValue("4301");
  await expect(page.getByLabel("Start with the computer")).toBeChecked();

  const identity = page.getByRole("region", { name: "Identity" });
  await expect(identity).toContainText("User: Ana Admin");
  // Both pages follow a rename of the user.
  await page.request.patch("/api/auth/me", { data: { displayName: "Ana Renamed" } });
  await page.reload();
  await expect(identity).toContainText("User: Ana Renamed");
  await identity.getByLabel("Name").fill("Laptop");
  await identity.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Edit connector: Laptop" })).toBeVisible();

  // Offline: what needs the connector says so, the hub-side settings stay editable.
  stream.abort();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(
    page.getByText("The connector is offline. This can only be changed").first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(row).toContainText("Laptop");
  await expect(row).toContainText("User: Ana Renamed");
  await expect(row.getByRole("button", { name: "Restart connector" })).toBeDisabled();

  await row.getByRole("button", { name: "Revoke" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Revoke Laptop?" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("No devices yet")).toBeVisible();
  expect((await asDevice()).status).toBe(401);
});
