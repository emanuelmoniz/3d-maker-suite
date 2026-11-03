// A real server and browser on a sterile copy of real data; only runs when given one:
//   REAL_DB=/path/app.sqlite pnpm exec playwright test real-data
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

test.skip(!process.env.REAL_DB, "needs REAL_DB");
test.setTimeout(600_000);

const PASSWORD = "password123";
const signIn = async (page: Page, name: string) => {
  const res = await page.request.post("/api/auth/login", {
    data: { email: `release-${name}@x.io`, password: PASSWORD },
  });
  expect(res.ok(), `sign in as ${name}`).toBe(true);
};

/**
 * Follows every link inside the app from the dashboard, one page per URL shape (`/printers/<id>`
 * once), the way a person clicks around. Each must load without a crash or a server error.
 */
const crawl = async (page: Page) => {
  const problems: string[] = [];
  let at = "/";
  page.on("pageerror", (e) => problems.push(`${at}: ${e.message}`));
  page.on("console", (m) => {
    // A refused request is the browser's own line, and the rule for this user: see the status below.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource"))
      problems.push(`${at}: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${at}: ${r.status()} ${r.url()}`);
  });
  const shape = (path: string) =>
    path.split("?")[0]?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id") ?? path;
  const seen = new Set<string>();
  const queue = ["/"];
  while (queue.length) {
    at = queue.shift() ?? "/";
    await page.goto(at);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("main"), at).toBeVisible();
    const links = await page
      .locator('a[href^="/"]:not([download]):not([target])')
      .evaluateAll((all) => all.map((a) => a.getAttribute("href") ?? ""));
    for (const link of links) {
      if (link.startsWith("/api") || seen.has(shape(link))) continue;
      seen.add(shape(link));
      queue.push(link);
    }
  }
  return { problems, pages: [...seen] };
};

for (const name of ["admin", "manager", "writer"]) {
  test(`every page opens for the ${name}, without an error`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, name);
    const { problems, pages } = await crawl(page);
    expect(problems).toEqual([]);
    expect(pages.length).toBeGreaterThan(10);
    console.log(`${name}: ${pages.length} pages`);
  });

  test(`every page opens on a phone for the ${name}, with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signIn(page, name);
    for (const path of ["/", "/printers", "/filament", "/projects", "/prints", "/clients"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(over, path).toBeLessThanOrEqual(0);
    }
  });
}

const SELECT_ALL = "Select all matching rows, on every page";

test("selection follows the level: a writer has none, a manager has it", async ({ page }) => {
  for (const [name, count] of [
    ["writer", 0],
    ["manager", 1],
    ["admin", 1],
  ] as const) {
    await page.context().clearCookies();
    await signIn(page, name);
    for (const path of ["/prints", "/printers/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const boxes = page.getByRole("checkbox", { name: SELECT_ALL });
      if (count) await expect(boxes.first(), `${name} ${path}`).toBeVisible();
      else await expect(boxes, `${name} ${path}`).toHaveCount(0);
    }
  }
});

test("a manager bulk archives all the real prints from the browser; stats don't move", async ({
  page,
}) => {
  await signIn(page, "manager");
  const total = async (q: string) =>
    (await (await page.request.get(`/api/prints?pageSize=1&${q}`)).json()).total as number;
  const stats = async () =>
    JSON.parse(await (await page.request.get("/api/stats")).text(), (k, v) =>
      k === "archivedAt" ? undefined : v,
    );
  const count = await total("archived=false");
  expect(count).toBeGreaterThan(100);
  const before = await stats();

  await page.goto("/prints");
  await page.getByRole("checkbox", { name: SELECT_ALL }).click();
  await expect(page.getByText(`${count} selected`)).toBeVisible();
  await page.getByRole("button", { name: `Archive ${count}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
  await expect.poll(() => total("archived=true"), { timeout: 120_000 }).toBe(count);
  expect(await total("archived=false")).toBe(0);
  expect(await stats()).toEqual(before);

  await page.goto("/prints?archived=true");
  await page.getByLabel("Show archived").first().check();
  await page.getByRole("checkbox", { name: SELECT_ALL }).click();
  await page.getByRole("button", { name: `Restore ${count}` }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Restore" });
  if (await confirm.isVisible()) await confirm.click();
  await expect.poll(() => total("archived=false"), { timeout: 120_000 }).toBe(count);
  expect(await stats()).toEqual(before);
});
