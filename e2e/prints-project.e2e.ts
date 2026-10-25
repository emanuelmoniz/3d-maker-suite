import { expect, test } from "./fixtures.ts";
import { seedPrinter, seedProject } from "./helpers.ts";

test("prints: project column links to the project, sorts and filters", async ({ page, app }) => {
  const printer = await seedPrinter(app.api);
  const project = await seedProject(app.api, "Dragon");
  const base = { printerId: printer.id, startedAt: new Date().toISOString(), usages: [] };
  await app.api("POST", "/api/prints", {
    ...base,
    title: "Tagged",
    outcome: "success",
    projectId: project.id,
  });
  await app.api("POST", "/api/prints", { ...base, title: "Loose", outcome: "success" });

  await page.goto("/prints");
  const table = page.getByRole("table", { name: "Prints" });
  await expect(table.getByRole("columnheader").first()).toContainText("Project");
  await expect(table.getByRole("link", { name: "001-Dragon" })).toHaveAttribute(
    "href",
    `/projects/${project.id}`,
  );

  await page.goto(`/prints?projectId=${project.id}`);
  await expect(table.getByRole("link", { name: "Tagged" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Loose" })).toHaveCount(0);
});

test("project page: prints table pages through the project's prints, without a Project column", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const project = await seedProject(app.api, "Dragon");
  for (let i = 0; i < 30; i++)
    await app.api("POST", "/api/prints", {
      printerId: printer.id,
      startedAt: new Date().toISOString(),
      usages: [],
      title: `Run ${i}`,
      outcome: "success",
      projectId: project.id,
    });

  await page.goto(`/projects/${project.id}`);
  await page.getByRole("heading", { name: "Prints", exact: true }).click();
  const table = page.getByRole("table", { name: "Prints" });
  await expect(table.getByRole("columnheader", { name: /Project/ })).toHaveCount(0);
  await expect(table.getByRole("row")).toHaveCount(26); // header + default page of 25
  await page.getByRole("button", { name: /next/i }).click();
  await expect(table.getByRole("row")).toHaveCount(6);
});
