import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

test("a collapsible card opens and closes from its whole title row (375px)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  const project = await (
    await page.request.post("/api/projects", { data: { name: "Vase", description: "A tall vase" } })
  ).json();

  await page.goto(`/projects/${project.id}`);
  const card = page.getByRole("region", { name: "Project info" });
  const header = card.getByRole("heading").getByRole("button");
  const text = card.getByText("A tall vase");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(text).toBeVisible();

  // Anywhere on the row, not just the text: the far right edge of the button.
  const box = await header.boundingBox();
  if (!box) throw new Error("no header");
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(text).toBeHidden();

  // Keyboard: Enter opens it again.
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(text).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
});
