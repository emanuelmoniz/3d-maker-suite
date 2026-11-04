/** Rows left on Skip that aren't counted as invalid: an invalid row the user fixed isn't one. */
export const skippedCount = (rows: { status: string; action: string }[]) =>
  rows.filter((r) => r.action === "skip" && r.status !== "invalid").length;
