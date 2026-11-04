import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { addRoots, pick, seedPrinter } from "./helpers.ts";

test("import projects: pick a folder, create one, add a print in the review", async ({
  page,
  app,
}) => {
  const root = app.makeProjectDir("cup");
  await addRoots(app.api, root);
  const printer = await seedPrinter(app.api);
  const benchy = await app.api<{ id: string }>("POST", "/api/prints", {
    printerId: printer.id,
    startedAt: new Date().toISOString(),
    usages: [],
    title: "Benchy",
    outcome: "success",
  });

  await page.goto("/import");
  await pick(page.getByRole("combobox", { name: "What to import" }), "Projects");
  await page.getByLabel("Upload a file").setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name;Folder\nMug;\nLamp;\n"),
  });
  const mug = page.getByRole("row").filter({ hasText: "Mug" });
  const lamp = page.getByRole("row").filter({ hasText: "Lamp" });
  await expect(mug.getByText("No folder")).toBeVisible();

  // Mug: the existing folder, picked inside the project root; it has files, so it asks.
  await mug.getByRole("button", { name: "Browse for Folder for row 2" }).click();
  const browse = page.getByRole("dialog", { name: "Folder for row 2" });
  // It opens at the root, which can't be picked itself.
  await expect(browse.getByRole("button", { name: "Select this folder" })).toBeDisabled();
  await browse.getByRole("button", { name: "cup" }).click();
  await browse.getByRole("button", { name: "Select this folder" }).click();
  await expect(mug.getByText(join(root, "cup"))).toBeVisible();
  await expect(mug.getByText("This folder already has files.")).toBeVisible();

  // Mug: a print added by hand.
  await mug.getByRole("button", { name: "0 prints for row 2: change" }).click();
  const prints = page.getByRole("dialog").filter({ hasText: "Prints of row 2" });
  await prints.getByRole("searchbox", { name: "Add a print" }).fill("Benchy");
  await prints.getByRole("button", { name: /Benchy/ }).click();
  await prints.getByRole("button", { name: "Confirm" }).click();
  await expect(mug.getByRole("button", { name: "1 print for row 2: change" })).toBeVisible();

  // Lamp: a folder the app makes, named by number and name.
  await lamp.getByRole("button", { name: "Create folder" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Create a folder" })
    .getByRole("button", {
      name: "Create folder",
    })
    .click();
  await expect(lamp.getByText("New folder, named by number and name")).toBeVisible();

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Import finished: 2 created, 0 updated.")).toBeVisible();

  const projects = await app.api<{ items: { id: string; name: string; folderPath: string }[] }>(
    "GET",
    "/api/projects?sort=name",
  );
  expect(projects.items.map((p) => [p.name, p.folderPath])).toEqual([
    ["Mug", join(root, "cup")],
    ["Lamp", join(root, "002_Lamp")],
  ]);
  const print = await app.api<{ projectId: string }>("GET", `/api/prints/${benchy.id}`);
  expect(print.projectId).toBe(projects.items[0]?.id);
});
