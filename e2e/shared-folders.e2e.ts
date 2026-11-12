import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openSources } from "./helpers.ts";

/** What a connector lists for `fs.list`: a Windows disk with D:\Models\Acme. */
const LISTING: Record<string, { name: string; path: string }[]> = {
  "": [{ name: "D:\\", path: "D:\\" }],
  "D:\\": [{ name: "Models", path: "D:\\Models" }],
  "D:\\Models": [{ name: "Acme", path: "D:\\Models\\Acme" }],
  "D:\\Models\\Acme": [],
};

test("shared folders: picked on the server, then a project folder from them (375px)", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
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
  const asDevice = (path: string, init: { method: string; body: unknown }) =>
    fetch(`${app.url}/api/hub/device${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(init.body),
    });

  // Online, answering `fs.list` as a connector does; a new one reports no folders of its own.
  const stream = new AbortController();
  const events = await fetch(`${app.url}/api/hub/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: stream.signal,
  });
  expect((await asDevice("/folders", { method: "PUT", body: [] })).status).toBe(200);
  const reader = events.body?.getReader();
  const dec = new TextDecoder();
  void (async () => {
    let text = "";
    while (reader) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      text += dec.decode(value, { stream: true });
      const blocks = text.split("\n\n");
      text = blocks.pop() ?? "";
      for (const block of blocks) {
        const id = /"requestId":"([^"]+)"/.exec(block)?.[1];
        const ask = /"type":"fs\.list".*"path":(null|"[^"]*")/.exec(block)?.[1];
        if (!id || ask === undefined) continue;
        const path: string | null = JSON.parse(ask);
        const entries = (LISTING[path ?? ""] ?? []).map((e) => ({ ...e, type: "dir" }));
        await asDevice(`/replies/${id}`, {
          method: "POST",
          body: { ok: true, result: { path, parent: null, sep: "\\", entries } },
        });
      }
    }
  })();

  await page.goto("/projects/settings/sources");
  await openSources(page);
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: /WS-1/, level: 3 }) });
  await expect(card).toContainText("Ana Admin");
  await expect(card).toContainText("No shared folders yet.");

  // Add folder: browse its disk, then confirm.
  await card.getByRole("button", { name: "Browse for Add a folder on WS-1" }).click();
  const picker = page.getByRole("dialog", { name: "Add a folder on WS-1" });
  await picker.getByRole("button", { name: "D:\\" }).click();
  await picker.getByRole("button", { name: "Models" }).click();
  await picker.getByRole("button", { name: "Select this folder" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Share D:\\Models with the server?" });
  await confirm.getByRole("button", { name: "Share" }).click();
  const line = card.getByRole("row").filter({ hasText: "D:\\Models" });
  await expect(line).toContainText("No project folder yet");
  await expect(line.getByRole("switch", { name: "Share D:\\Models" })).toBeChecked();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // A project folder from it: the source first, then a folder inside its shared folders.
  await page.goto("/projects/settings");
  await page.getByRole("button", { name: "Browse for Project folders" }).click();
  const roots = page.getByRole("dialog", { name: "Project folders" });
  await expect(roots.getByRole("button", { name: "This server" })).toBeVisible();
  await roots.getByRole("button", { name: "WS-1" }).click();
  await roots.getByRole("button", { name: "Models" }).click();
  await roots.getByRole("button", { name: "Acme" }).click();
  await roots.getByRole("button", { name: "Select this folder" }).click();
  await expect(page.getByText("D:\\Models\\Acme")).toBeVisible();
  await expect(page.getByText("On WS-1")).toBeVisible();

  // Paused, then removed, from its line.
  await page.goto("/projects/settings/sources");
  await openSources(page);
  await expect(line).toContainText("Acme");
  await line.getByRole("switch", { name: "Share D:\\Models" }).click({ force: true });
  await expect(line.getByRole("switch", { name: "Share D:\\Models" })).not.toBeChecked();
  const saved = async () =>
    (
      (await (await page.request.get("/api/hub/devices")).json()) as {
        id: string;
        sharedFolders: unknown;
      }[]
    ).find((d) => d.id === deviceId)?.sharedFolders;
  expect(await saved()).toEqual([{ path: "D:\\Models", paused: true }]);
  await line.getByLabel("More for D:\\Models").click();
  await line.getByRole("button", { name: "Remove", exact: true }).click();
  const removing = page.getByRole("dialog").filter({ hasText: "Stop sharing D:\\Models?" });
  await removing.getByRole("button", { name: "Remove" }).click();
  await expect(card).toContainText("No shared folders yet.");
  expect(await saved()).toEqual([]);
  stream.abort();
});
