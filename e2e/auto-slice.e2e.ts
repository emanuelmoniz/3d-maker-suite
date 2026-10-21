import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";

type Slicing = { plates: { state: string; result: { slicedAt: string } | null; job: unknown }[] };
const fixture = (name: string) => join(import.meta.dirname, `../packages/3mf/fixtures/${name}.3mf`);

test("project folders: auto slice per folder, and removing one", async ({ page, app }) => {
  const a = join(app.dataDir, "models");
  const b = join(app.dataDir, "archive");
  mkdirSync(a);
  mkdirSync(b);
  await app.api("PATCH", "/api/preferences", { projectRoots: [a, b] });
  const prefs = async () =>
    (
      await app.api<{ values: { projectRoots: string[]; autoSliceOffRoots: string[] } }>(
        "GET",
        "/api/preferences",
      )
    ).values;

  await page.goto("/projects/settings");
  const auto = page.getByRole("checkbox", { name: `Auto slice projects in ${b}` });
  await expect(page.getByRole("checkbox", { name: `Auto slice projects in ${a}` })).toBeChecked();
  await expect(auto).toBeChecked();
  // Controlled by the saved value: it unticks once the save is back.
  await auto.click();
  await expect(auto).not.toBeChecked();
  await expect.poll(async () => (await prefs()).autoSliceOffRoots).toEqual([b]);

  await page.getByRole("button", { name: `Remove ${b}` }).click();
  await expect(auto).toHaveCount(0);
  expect(await prefs()).toMatchObject({ projectRoots: [a], autoSliceOffRoots: [] });

  await page.getByRole("textbox", { name: "Folder path" }).fill(b);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(auto).toBeChecked();
});

test("a changed file slices again; a new slot raises an alert that opens the print setup", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(join(root, "Benchy"), { recursive: true });
  const file = join(root, "Benchy", "benchy.3mf");
  copyFileSync(fixture("multi_color"), file);
  await app.api("PATCH", "/api/preferences", { projectRoots: [root] });
  const project = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Benchy",
    folderPath: join(root, "Benchy"),
  });
  const mock = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${mock.id}`, { slicerPath: process.execPath });
  // The watcher follows the roots from the end of a full scan on.
  await app.api("POST", "/api/projects/scan");
  await expect
    .poll(async () => (await app.api<{ state: string }>("GET", "/api/projects/scan")).state)
    .toBe("idle");
  const url = `/api/projects/${project.id}/slicing`;
  const plate = async () => (await app.api<Slicing>("GET", url)).plates[0];
  const setup = (slots: number) =>
    app.api("PUT", url, {
      plates: [
        { file: "benchy.3mf", plate: 1, printProfileId: null, filaments: Array(slots).fill(null) },
      ],
    });

  // Sliced once by hand, with a setup for the file's 4 slots.
  await setup(4);
  await app.api("POST", `${url}/run`);
  await expect.poll(async () => (await plate())?.result?.slicedAt).toBeTruthy();
  const first = (await plate())?.result?.slicedAt;

  // Same plates and slots, other bytes: the watcher's scan slices it again.
  copyFileSync(fixture("single_color"), file);
  await expect
    .poll(async () => (await plate())?.result?.slicedAt, { timeout: 15_000 })
    .not.toBe(first);
  expect(await plate()).toMatchObject({ state: "ok", job: null });

  // A setup for 3 slots, then a file whose plate uses slot 4: an alert, no slice.
  await setup(3);
  copyFileSync(fixture("unsliced"), file);
  await page.goto("/alerts");
  const alert = page.getByRole("link", {
    name: "benchy.3mf in Benchy changed its plates or filament slots: check the print setup",
  });
  await expect(async () => {
    await page.reload();
    await expect(alert).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  expect((await plate())?.result).toBeNull();
  await alert.click();
  await page.getByRole("link", { name: "Open print setup" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/edit#slicing$`));

  // The project's own choice, kept.
  const choice = page.getByRole("combobox", { name: "Slice again when the file changes" });
  await expect(choice).toHaveValue("");
  await expect(choice.locator("option:checked")).toHaveText("As the project folder says (on)");
  await choice.selectOption("off");
  await expect(choice).toBeEnabled();
  await page.reload();
  await expect(choice).toHaveValue("off");
});
