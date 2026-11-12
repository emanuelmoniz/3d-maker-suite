import { expect, test } from "./fixtures.ts";
import { seedPrinter, seedProject } from "./helpers.ts";

test("tags setting: off hides column, picker and filters; on restores them", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const a = await seedProject(app.api, "Tagged One");
  await seedProject(app.api, "Plain Two");
  const tag = await app.api<{ id: string }>("POST", "/api/tags", {
    name: "Gift",
    color: "#3b82f6",
  });
  await app.api("PUT", `/api/tags/taggings/project/${a.id}`, { tagIds: [tag.id] });
  await app.api("PUT", `/api/tags/taggings/printer/${printer.id}`, { tagIds: [tag.id] });

  await page.goto("/printers");
  await expect(page.getByRole("columnheader", { name: "Tags" })).toBeVisible();

  // A project can get a tag from its form.
  await page.goto("/projects/new");
  await page.getByLabel("Name", { exact: true }).fill("From Form");
  await page.getByRole("button", { name: "Gift" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  // No folder: the form returns to the list.
  await expect(page).toHaveURL(/\/projects$/);
  const tagged = await app.api<{ entityId: string }[]>(
    "GET",
    "/api/tags/taggings?entityType=project",
  );
  expect(tagged).toHaveLength(2);

  await app.api("PATCH", "/api/preferences", { tagsEnabled: false });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/tags")) requests.push(r.url());
  });

  // A saved ?tagId= link shows every row while tags are off.
  await page.goto(`/projects?tagId=${tag.id}`);
  await expect(page.getByRole("link", { name: /Plain Two/ })).toBeVisible();
  await expect(page.getByLabel("Filter by tag")).toHaveCount(0);
  await page.goto("/printers");
  await expect(page.getByRole("link", { name: /Test Printer/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Tags" })).toHaveCount(0);
  await page.goto("/projects/new");
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gift" })).toHaveCount(0);
  await page.goto(`/printers/${printer.id}`);
  await expect(page.getByText("Tags", { exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);

  await app.api("PATCH", "/api/preferences", { tagsEnabled: true });
  await page.goto("/printers");
  await expect(page.getByRole("columnheader", { name: "Tags" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Gift" })).toBeVisible();
});

test("tags setting: the switch in Settings saves", async ({ page, app }) => {
  await page.goto("/settings");
  const sw = page.getByRole("switch", { name: "Tags" });
  await expect(sw).toBeChecked();
  await sw.click({ force: true });
  await expect
    .poll(
      async () =>
        (await app.api<{ values: { tagsEnabled: boolean } }>("GET", "/api/preferences")).values
          .tagsEnabled,
    )
    .toBe(false);
});
