import { expect, test } from "./fixtures.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function openPairingCode(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  await page.reload();
  await page.goto("/settings/hub");
  await page.getByRole("button", { name: "Pair a device" }).click();
  const pair = page.getByRole("dialog", { name: "Pair a device" });
  await pair.getByLabel("User").click();
  await page.getByRole("option", { name: "Ana Admin" }).click();
  await pair.getByRole("button", { name: "Create code" }).click();
  const shown = page.getByRole("dialog").filter({ hasText: "Pairing code" });
  const code = (await shown.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/).textContent()) ?? "";
  return { shown, code };
}

test("copy the pairing code to the clipboard", async ({ page }) => {
  const { shown, code } = await openPairingCode(page);
  await shown.getByRole("button", { name: "Copy code" }).click();
  await expect(shown.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  // Keyboard: the button is reachable and activates with Enter.
  await shown.getByRole("button", { name: "Done" }).focus();
  await shown.getByRole("button", { name: "Copy code" }).focus();
  await page.keyboard.press("Enter");
  await expect(shown.getByRole("status")).toHaveText("Copied");
});

test("copy falls back when the clipboard API is missing (LAN address, not a secure context)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  const { shown } = await openPairingCode(page);
  await shown.getByRole("button", { name: "Copy code" }).click();
  await expect(shown.getByRole("status")).toHaveText("Copied");
});
