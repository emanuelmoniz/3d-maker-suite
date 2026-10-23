import { expect, test } from "./fixtures.ts";

type Policy = { type: string; scope: string; merge: string };

test("sync options: what to sync and how to sync, with a hint per choice", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await page.goto("/integrations");

  // Print history never changes once imported: no options.
  await page.getByRole("button", { name: "Settings: Print history" }).click();
  await expect(page.getByRole("combobox", { name: "What to sync: Print history" })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings: Printers" }).click();
  const scope = page.getByRole("combobox", { name: "What to sync: Printers" });
  const merge = page.getByRole("combobox", { name: "How to sync: Printers" });
  await expect(scope).toHaveValue("Everything");
  // Printers default to reviewing changes.
  await expect(merge).toHaveValue("Let me review the changes");
  const row = page.getByRole("listitem").filter({ hasText: /^Printers/ });
  await expect(row.getByText(/you get an alert and decide/)).toBeVisible();

  await scope.click();
  await page.getByRole("option", { name: "Only what I already have" }).click();
  await expect(scope).toHaveValue("Only what I already have");
  await expect(row.getByText(/only if you have its brand/)).toBeVisible();
  await merge.click();
  await page.getByRole("option", { name: "Keep my edits" }).click();
  await expect(merge).toHaveValue("Keep my edits");

  const policies = (await app.api<{ policies: Policy[] }>("GET", `/api/integrations/${id}`))
    .policies;
  expect(policies.find((p) => p.type === "printers")).toMatchObject({
    scope: "imported",
    merge: "keepEdits",
  });
});
