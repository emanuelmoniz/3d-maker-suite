import { expect, test } from "./fixtures.ts";
import { editLine, lineMenu } from "./helpers.ts";

type Policy = { type: string; scope: string; merge: string };

test("sync options: what to sync and how to sync, with a hint per choice", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });

  // Print history never changes once imported: no options.
  let dialog = await editLine(page, "prints", "Print history");
  await expect(dialog.getByRole("combobox", { name: "What to sync: Print history" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  dialog = await editLine(page, "printers", "Printers");
  const scope = dialog.getByRole("combobox", { name: "What to sync: Printers" });
  const merge = dialog.getByRole("combobox", { name: "How to sync: Printers" });
  await expect(scope).toHaveValue("Everything");
  // Printers default to reviewing changes.
  await expect(merge).toHaveValue("Let me review the changes");
  await expect(dialog.getByText(/you get an alert and decide/)).toBeVisible();

  await scope.click();
  await page.getByRole("option", { name: "Only what I already have" }).click();
  await expect(scope).toHaveValue("Only what I already have");
  await expect(dialog.getByText(/only if you have its brand/)).toBeVisible();
  await merge.click();
  await page.getByRole("option", { name: "Keep my edits" }).click();
  await expect(merge).toHaveValue("Keep my edits");

  // A draft until Save; the line then says what and how.
  const printers = async () =>
    (await app.api<{ policies: Policy[] }>("GET", `/api/integrations/${id}`)).policies.find(
      (p) => p.type === "printers",
    );
  expect(await printers()).toMatchObject({ scope: "all", merge: "review" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(printers).toMatchObject({ scope: "imported", merge: "keepEdits" });
  const line = page.getByRole("region", { name: /^What .* syncs$/ });
  await expect(line.getByRole("cell", { name: "Only what I already have" })).toBeVisible();
  await expect(line.getByRole("cell", { name: "Keep my edits" })).toBeVisible();

  // Cancel drops the draft.
  dialog = await editLine(page, "printers", "Printers");
  await scope.click();
  await page.getByRole("option", { name: "Everything" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(printers).toMatchObject({ scope: "imported" });
});

test("sync time: a daily auto type runs at the time picked, any time clears it", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  const prints = async () =>
    (
      await app.api<{ policies: (Policy & Record<string, unknown>)[] }>(
        "GET",
        `/api/integrations/${id}`,
      )
    ).policies.find((p) => p.type === "prints");
  const patches: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/api/integrations/"))
      patches.push(r.postDataJSON());
  });
  let dialog = await editLine(page, "prints", "Print history");

  // Hourly by default: a minute, unset.
  const minute = dialog.getByRole("button", { name: "Minute: Print history" });
  await expect(minute).toHaveText("Any time");
  await dialog.getByRole("combobox", { name: "Frequency: Print history" }).click();
  await page.getByRole("option", { name: "Every day" }).click();

  const time = dialog.getByRole("button", { name: "Time: Print history" });
  await expect(time).toHaveText("Any time");
  await time.click();
  const panel = page.getByRole("dialog", { name: "Time: Print history" });
  await panel.getByRole("button", { name: "07", exact: true }).click();
  await panel.getByRole("button", { name: "30", exact: true }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toBeHidden();
  await expect(time).toHaveText("07:30");
  // Everything the dialog changed, in one save.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(prints).toMatchObject({ frequency: "1d", atHour: 7, atMinute: 30 });
  expect(patches).toEqual([
    { policies: [{ type: "prints", frequency: "1d", atHour: 7, atMinute: 30 }] },
  ]);
  await expect(page.getByText("Auto, every day at 07:30")).toBeVisible();

  // The 12-hour setting shows the time and the hours that way.
  await app.api("PATCH", "/api/preferences", { timeFormat: "12h" });
  await page.reload();
  dialog = await editLine(page, "prints", "Print history");
  await expect(time).toHaveText(/^7:30\sAM$/);
  await time.click();
  await panel.getByRole("button", { name: "PM" }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.poll(prints).toMatchObject({ atHour: 19, atMinute: 30 });

  // Escape drops the picker's draft; Any time clears the time.
  dialog = await editLine(page, "prints", "Print history");
  await time.click();
  await panel.getByRole("button", { name: "AM" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(time).toHaveText(/^7:30\sPM$/);
  await time.click();
  await panel.getByRole("button", { name: "Any time" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.poll(prints).toMatchObject({ atHour: null, atMinute: null });

  // Weekly: a weekday and an hour from the same picker, without minutes.
  dialog = await editLine(page, "prints", "Print history");
  await dialog.getByRole("combobox", { name: "Frequency: Print history" }).click();
  await page.getByRole("option", { name: "Every week" }).click();
  const hour = dialog.getByRole("button", { name: "Hour: Print history" });
  await hour.click();
  await expect(panel).toHaveCount(0);
  const hourPanel = page.getByRole("dialog", { name: "Hour: Print history" });
  await expect(hourPanel.getByText("Minute")).toHaveCount(0);
  await hourPanel.getByRole("button", { name: "6", exact: true }).click();
  await hourPanel.getByRole("button", { name: "Done" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.poll(prints).toMatchObject({ frequency: "1w", atHour: 6, atMinute: null });
});

test("review a period of print history: every print in it, imported or not", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });
  await page.goto("/prints/settings/sources");
  await lineMenu(page, "Print history");
  await page.getByRole("button", { name: "Review and import a period…" }).click();
  const dialog = page.getByRole("dialog", { name: "Review and import a period" });
  const period = dialog.getByRole("combobox", { name: "Period" });
  await expect(period).toHaveValue("Since the last sync");
  await period.click();
  // The mock's prints are from January.
  await page.getByRole("option", { name: "This year" }).click();
  await dialog.getByRole("button", { name: "Review and import period" }).click();
  // A review, not a run: the prints already synced are offered again.
  await expect(page).toHaveURL(new RegExp(`/import/integration/${id}/prints\\?from=`));
  await expect(
    page.getByRole("button", { name: /^Edit Name, row \d+ Mock print 1$/ }),
  ).toBeVisible();
  const runs = await app.api<{ items: { rangeFrom: string | null }[] }>(
    "GET",
    `/api/integrations/${id}/runs`,
  );
  expect(runs.items.some((r) => r.rangeFrom)).toBe(false);
});
