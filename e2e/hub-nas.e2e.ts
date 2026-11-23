import { expect, test } from "./fixtures.ts";

test("hub: pair a NAS or container, see how it is installed, and answer what it holds", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
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
  await page.goto("/settings/hub");

  // A NAS, server or container: a 24-hour code, and the lines to paste with the address filled in.
  await page.getByRole("button", { name: "Pair a device" }).click();
  const pair = page.getByRole("dialog", { name: "Pair a device" });
  await pair.getByRole("radio", { name: /A NAS, server or container/ }).check();
  await pair.getByLabel("User").click();
  await page.getByRole("option", { name: "Ana Admin" }).click();
  await pair.getByRole("button", { name: "Create code" }).click();
  const shown = page.getByRole("dialog", { name: "Pair a NAS or server" });
  const code = (await shown.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/).textContent()) ?? "";
  await expect(shown.getByLabel("Hub address")).toHaveValue(new URL(page.url()).origin);
  await shown.getByLabel("Hub address").fill("http://nas.local:4300");
  const compose = shown.locator("pre").filter({ hasText: "network_mode: host" });
  await expect(compose).toContainText('CONNECTOR_HUB_URL: "http://nas.local:4300"');
  await expect(compose).toContainText(`CONNECTOR_PAIRING_CODE: "${code}"`);
  await expect(compose).toContainText("# PUID: 1000");
  await expect(compose).toContainText("propagation: rslave");
  await expect(shown.locator("pre").nth(1)).toContainText(
    "docker compose -f docker-compose.connector.yml up -d",
  );
  await shown.getByRole("radio", { name: "Linux service" }).check();
  await expect(shown.locator("pre")).toContainText(
    `./install.sh --headless --hub-url http://nas.local:4300 --pairing-code ${code}`,
  );
  await shown.getByRole("radio", { name: "Windows Server" }).check();
  await expect(shown.locator("pre").first()).toContainText(
    `/ALLUSERS /HEADLESS /HUBURL=http://nas.local:4300 /PAIRINGCODE=${code}`,
  );
  await expect(shown.locator("pre").nth(1)).toContainText("/ACCOUNT=DOMAIN\\name /PASSWORDFILE=");
  await shown.getByRole("button", { name: "Done" }).click();

  // Unused until a connector pairs with it; withdrawn, it pairs nothing.
  const unused = page.getByRole("region", { name: "Unused pairing codes" });
  await expect(unused).toContainText("Ana Admin · NAS or server · until");
  const pairWith = (c: string) =>
    app.api<{ token: string; deviceId: string }>("POST", "/api/hub/pair", {
      code: c,
      name: "NAS",
      os: "Linux 6.6.31 arm64",
      connectorVersion: "5.0.0",
      install: "docker",
    });
  const nas = await pairWith(code);
  await page.reload();
  await expect(unused).toHaveCount(0);

  const spare = await post("/api/hub/pairing-codes", { userId: anaId, kind: "headless" });
  await page.reload();
  await expect(unused).toContainText("NAS or server");
  await unused.getByRole("button", { name: /^Withdraw the code for Ana Admin/ }).click();
  await expect(unused).toHaveCount(0);
  await expect(pairWith(spare.code)).rejects.toThrow();

  // The machine page: how it is installed, and the command instead of Update now.
  await page.goto(`/hub/devices/${nas.deviceId}`);
  const software = page.getByRole("region", { name: "Software" });
  await expect(software).toContainText("Installed as: Docker container");
  await expect(software).toContainText("Architecture: arm64");
  await expect(software).toContainText("it doesn't update itself");
  await expect(software.locator("pre")).toContainText(
    "docker compose -f docker-compose.connector.yml pull",
  );
  await expect(software.getByRole("button", { name: "Update now" })).toHaveCount(0);

  // Linux on ARM can't slice: the switch can't be turned on, and the page says why.
  const slicers = page.getByRole("region", { name: "Slicers", exact: true });
  await expect(slicers.getByRole("switch", { name: "Use slicer as server worker" })).toBeDisabled();
  await expect(slicers).toContainText("A Linux machine on ARM can't be a slice worker");
  const refused = await page.request.patch(`/api/hub/devices/${nas.deviceId}`, {
    data: { useAsWorker: true },
  });
  expect(refused.status()).toBe(409);

  // What the connector does: hold the stream open, and answer a live request.
  const stream = new AbortController();
  const events = await fetch(`${app.url}/api/hub/events`, {
    headers: { authorization: `Bearer ${nas.token}` },
    signal: stream.signal,
  });
  const asked: string[] = [];
  const reader = events.body?.getReader();
  const dec = new TextDecoder();
  void (async () => {
    while (reader) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      for (const frame of dec.decode(value, { stream: true }).split("\n\n")) {
        const id = /"requestId":"([^"]+)"/.exec(frame)?.[1];
        if (!id || !frame.includes("sync.held")) continue;
        asked.push(frame);
        await fetch(`${app.url}/api/hub/device/replies/${id}`, {
          method: "POST",
          headers: { authorization: `Bearer ${nas.token}`, "content-type": "application/json" },
          body: JSON.stringify({ ok: true, result: null }),
        });
      }
    }
  })();
  const rootId = "11111111-1111-4111-8111-111111111111";
  await fetch(`${app.url}/api/hub/device/sync/state`, {
    method: "PUT",
    headers: { authorization: `Bearer ${nas.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      state: "paused",
      files: 40,
      pending: 0,
      held: [{ rootId, name: "Photos", files: 25 }],
      error: null,
    }),
  });

  // A folder that went missing: the same two choices as on the connector's own page.
  await page.reload();
  const projects = page.getByRole("region", { name: "Projects", exact: true });
  await expect(projects).toContainText("Photos: 25 files deleted at once, and held");
  await projects.getByRole("button", { name: "Restore the files held in Photos" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain('"action":"restore"');
  await projects
    .getByRole("button", { name: "Delete the files held in Photos on the hub too" })
    .click();
  const sure = page.getByRole("dialog", {
    name: "Delete the files held in Photos on the hub too?",
  });
  await sure.getByRole("button", { name: "Delete on the hub too" }).click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toContain('"action":"confirm"');
  expect(asked[1]).toContain(rootId);

  // A connector with no screen: its user changes at once, with no code.
  const identity = page.getByRole("region", { name: "Identity" });
  await identity.getByRole("button", { name: "Change user" }).click();
  const change = page.getByRole("dialog", { name: "Change this connector's user" });
  await expect(change).toContainText("No code is needed");
  await change.getByRole("combobox", { name: "User" }).click();
  await page.getByRole("option", { name: "Ben Bench" }).click();
  await change.getByRole("button", { name: "Change user" }).click();
  await expect(identity).toContainText("User: Ben Bench");
  await expect(identity).toContainText("Now acting as Ben Bench. 0 projects moved.");
  const me = await fetch(`${app.url}/api/auth/me`, {
    headers: { authorization: `Bearer ${nas.token}` },
  });
  expect((await me.json()).user.displayName).toBe("Ben Bench");
  stream.abort();
});
