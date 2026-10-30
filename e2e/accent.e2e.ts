import { expect, test } from "./fixtures.ts";

test("settings: the accent selector shows the picked color at once and after a reload", async ({
  page,
}) => {
  await page.goto("/settings");
  const accent = page.getByRole("combobox", { name: "Accent colour" });
  await accent.click();
  await page.getByRole("option", { name: "Rose" }).click();
  await expect(accent).toHaveValue("Rose");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Accent colour" })).toHaveValue("Rose");
});
