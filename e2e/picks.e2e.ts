import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openSources } from "./helpers.ts";

test("picks: add one in Projects settings → Sources, pause it, the machine page counts it (375px)", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  const dir = join(mkdtempSync(join(tmpdir(), "3dms-picks-")), "Models");
  mkdirSync(dir, { recursive: true });
  expect((await page.request.post("/api/roots", { data: { path: dir } })).ok()).toBe(true);
  const me = await (await page.request.get("/api/auth/me")).json();
  const { code } = await (
    await page.request.post("/api/hub/pairing-codes", { data: { userId: me.user.id } })
  ).json();
  // New machines receive nothing until picked (the default).
  const { deviceId } = await app.api<{ deviceId: string }>("POST", "/api/hub/pair", {
    code,
    name: "WS-1",
    os: "win32",
  });

  await page.goto("/projects/settings/sources");
  await openSources(page);
  const card = page
    .getByRole("region", { name: "Receive from server" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: /WS-1/, level: 3 }) });
  await expect(card).toContainText("No picks yet");

  // Add pick: the whole project folder, for the machine's user at Edit.
  await card.getByRole("button", { name: "Add pick" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a pick for WS-1" });
  await expect(dialog).toContainText("The whole project folder");
  await expect(dialog).toContainText("WS-1 receives a pick only when Ana Admin is on its list");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  const line = card.getByRole("row").filter({ hasText: "Models (whole folder)" });
  await expect(line).toContainText("Ana Admin: Edit");
  expect(await hasHorizontalScroll(page)).toBe(false);

  // Its switch pauses it; it stays listed.
  const on = line.getByRole("switch", { name: "Receive Models (whole folder) on WS-1" });
  await on.click({ force: true });
  await expect(on).not.toBeChecked();
  const picks = async () =>
    (
      (await (await page.request.get("/api/hub/devices")).json()) as {
        id: string;
        picks: { path: string; paused: boolean }[];
      }[]
    ).find((d) => d.id === deviceId)?.picks;
  expect((await picks())?.map((p) => [p.path, p.paused])).toEqual([["", true]]);

  // The machine page counts it and links back to its card.
  await page.goto(`/hub/devices/${deviceId}`);
  await expect(page.getByText("1 pick", { exact: true })).toBeVisible();

  // Removed from its line.
  await page.goto("/projects/settings/sources");
  await openSources(page);
  await line.getByLabel("More for Models (whole folder)").click();
  await line.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Stop receiving Models (whole folder) on WS-1?" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(card).toContainText("No picks yet");
  expect(await picks()).toEqual([]);
});
