import { expect, test } from "./fixtures.ts";

test("public address: pick, refuse a bad value, go back to automatic", async ({ page }) => {
  await page.goto("/settings");
  const group = page.getByRole("group", { name: "Public address" });
  const status = group.getByRole("status");
  await group.getByRole("radio", { name: /Domain or external IP/ }).check();
  const field = group.getByRole("textbox", { name: "Address" });

  await field.fill("ftp://maker.example.com");
  await field.blur();
  await expect(group.getByRole("alert")).toContainText("http://");

  await field.fill("https://maker.example.com/");
  await field.blur();
  await expect(status).toContainText("https://maker.example.com.");
  await expect(status).not.toContainText("com/.");

  await group.getByRole("button", { name: "Use this address" }).click();
  await expect(status).toContainText(new URL(page.url()).origin);

  await group.getByRole("radio", { name: /Automatic/ }).check();
  await expect(status).not.toContainText("maker.example.com");
});
