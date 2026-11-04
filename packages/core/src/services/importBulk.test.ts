import { describe, expect, it } from "vitest";
import {
  IMPORT_COLUMNS,
  type ImportColumn,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportStatus,
  type ImportValues,
  NO_PROJECT,
} from "../schemas/import.ts";
import { type ImportDecision, mergeValues } from "./import.ts";
import {
  type BulkForm,
  bulkEdit,
  bulkField,
  inRoot,
  lastFolder,
  pickOptions,
} from "./importBulk.ts";

const spoolCols: readonly ImportColumn[] = IMPORT_COLUMNS.spools;
const printCols: readonly ImportColumn[] = IMPORT_COLUMNS.prints;
const projectCols: readonly ImportColumn[] = IMPORT_COLUMNS.projects;
const col = (cols: readonly ImportColumn[], key: string) =>
  cols.find((c) => c.key === key) as ImportColumn;

const row = (
  n: number,
  status: ImportStatus,
  targetId: string | null = null,
  extra: Partial<ImportPreviewRow> = {},
) =>
  ({
    row: n,
    status,
    targetId,
    candidates: targetId ? [targetId] : [],
    values: {},
    raw: {},
    errors: [],
    action: status === "new" ? "create" : status === "changed" ? "update" : "skip",
    ...extra,
  }) satisfies ImportPreviewRow;

const invalid = (n: number, column = "location", extra: Partial<ImportPreviewRow> = {}) =>
  row(n, "invalid", null, { errors: [{ column, code: "required" }], ...extra });

const target = (id: string, values = {}) => ({ id, label: id, values });

const rows: ImportPreviewRow[] = [
  row(2, "new"),
  row(3, "identical", "a"),
  row(4, "changed", "b"),
  row(5, "ambiguous"),
  invalid(6, "status"),
];
const targets = [target("a"), target("b"), target("c")];

/** Spools by default: every row selected, nothing decided or edited yet. */
const run = (
  form: Partial<BulkForm>,
  opts: {
    all?: ImportPreviewRow[];
    selected?: number[];
    decisions?: Record<number, ImportDecision>;
    edits?: Record<number, ImportValues>;
    columns?: readonly ImportColumn[];
    shown?: string[];
    preview?: Pick<ImportPreview, "refOptions" | "refsOptional">;
  } = {},
) => {
  const all = opts.all ?? rows;
  const columns = opts.columns ?? spoolCols;
  return bulkEdit({
    preview: { rows: all, targets, ...opts.preview },
    columns,
    shown: opts.shown ?? columns.map((c) => c.key),
    selected: opts.selected ?? all.map((r) => r.row),
    decisions: opts.decisions ?? {},
    edits: opts.edits ?? {},
    form: { action: "keep", fields: {}, ...form },
  });
};

const actions = (out: ReturnType<typeof run>, all: ImportPreviewRow[] = rows) =>
  all.map((r) => out.decisions[r.row]?.action ?? "-").join(" ");

describe("column rules", () => {
  it("hides the columns that differ per row", () => {
    const hidden = (entity: keyof typeof IMPORT_COLUMNS) =>
      (IMPORT_COLUMNS[entity] as readonly ImportColumn[]).filter((c) => c.perRow).map((c) => c.key);
    for (const e of ["spools", "printers", "accessories", "prints", "quotes", "orders"] as const)
      expect(hidden(e)).toEqual(["number"]);
    expect(hidden("projects")).toEqual(["number", "folder"]);
    expect(hidden("clients")).toEqual(["mobile", "vat", "email"]);
    expect(hidden("brands")).toEqual(["name"]);
    expect(hidden("printerModels")).toEqual(["model"]);
    expect(hidden("filamentBrands")).toEqual(["name"]);
    expect(hidden("filamentMaterials")).toEqual(["name"]);
    expect(hidden("maintenanceTypes")).toEqual(["name"]);
    expect(hidden("filamentProfiles")).toEqual(["name"]);
  });

  it("knows what sets a column", () => {
    expect(col(printCols, "filament").setBy).toEqual({ column: "spool" });
    expect(col(printCols, "filament16").setBy).toEqual({ column: "spool16" });
    expect(col(printCols, "failureReason").setBy).toEqual({ column: "outcome", value: "success" });
    expect(projectCols.filter((c) => c.scanned).map((c) => c.key)).toEqual([
      "name",
      "description",
      "sourceUrl",
    ]);
  });
});

describe("pickOptions", () => {
  it("offers a spool added in the review to spool columns only", () => {
    const preview = {
      refOptions: { project: [{ id: "p", label: "Vase" }], spool: [], spool2: [] },
    };
    const added = [{ id: "new", label: "New spool" }];
    const ids = (key: string) =>
      pickOptions(preview, row(2, "new"), key, null, added).map((o) => o.id);
    expect(ids("spool")).toEqual(["new"]);
    expect(ids("spool2")).toEqual(["new"]);
    expect(ids("project")).toEqual(["p"]);
  });
});

describe("bulkField", () => {
  const onCreate: ImportDecision = { action: "create", targetId: null };
  const onUpdate: ImportDecision = { action: "update", targetId: "a" };
  const onSkip: ImportDecision = { action: "skip", targetId: null };
  const field = (
    c: ImportColumn,
    action: BulkForm["action"],
    selected: ImportDecision[] = [onCreate, onUpdate],
    fields: BulkForm["fields"] = {},
    preview = {},
  ) => bulkField(c, { form: { action, fields }, selected, preview });
  const location = col(spoolCols, "location");

  it("offers each Action's options", () => {
    expect(field(location, "keep")).toEqual(["import", "value"]);
    expect(field(location, "create")).toEqual(["import", "value", "empty"]);
    expect(field(location, "update")).toEqual(["overwrite", "keepEdits", "value"]);
  });

  it("disables everything under Skip and Use suggestion, or when every row is on Skip", () => {
    expect(field(location, "skip")).toBe("disabled");
    expect(field(location, "suggestion")).toBe("disabled");
    expect(field(location, "keep", [onSkip, onSkip])).toBe("disabled");
    expect(field(location, "keep", [onSkip, onCreate])).toEqual(["import", "value"]);
    expect(field(location, "create", [onSkip, onSkip])).toEqual(["import", "value", "empty"]);
  });

  it("only offers Empty on an optional column; a required pick isn't one", () => {
    expect(field(col(spoolCols, "material"), "create")).toEqual(["import", "value"]);
    const preview = { refOptions: { project: [], spool: [] }, refsOptional: ["spool"] };
    expect(field(col(printCols, "project"), "create", undefined, {}, preview)).toEqual([
      "import",
      "value",
    ]);
    expect(field(col(printCols, "spool"), "create", undefined, {}, preview)).toEqual([
      "import",
      "value",
      "empty",
    ]);
  });

  it("gives Track usage no merge options and no Empty", () => {
    const track = col(printCols, "trackUsage");
    for (const a of ["keep", "create", "update"] as const)
      expect(field(track, a)).toEqual(["import", "value"]);
  });

  it("hides per-row columns with several rows, and shows them with one", () => {
    const number = col(spoolCols, "number");
    expect(field(number, "create")).toBe("hidden");
    expect(field(number, "create", [onCreate])).toEqual(["import", "value", "empty"]);
  });

  it("locks the number on an update, as the table does", () => {
    const number = col(spoolCols, "number");
    expect(field(number, "update", [onCreate])).toBe("readOnly");
    expect(field(number, "keep", [onUpdate])).toBe("readOnly");
    expect(field(number, "create", [onUpdate])).toEqual(["import", "value", "empty"]);
  });

  it("locks a column another field sets", () => {
    const filament = col(printCols, "filament");
    const spool = { kind: "value", text: "S1", id: "s" } as const;
    expect(field(filament, "create", undefined, { spool })).toBe("readOnly");
    expect(field(filament, "create", undefined, { spool: { kind: "empty" } })).toEqual(
      expect.arrayContaining(["value"]),
    );
    const reason = col(printCols, "failureReason");
    const outcome = (text: string) => ({ outcome: { kind: "value", text } }) as const;
    expect(field(reason, "create", undefined, outcome("success"))).toBe("readOnly");
    expect(field(reason, "create", undefined, outcome("failed"))).toEqual(
      expect.arrayContaining(["value"]),
    );
  });

  it("locks the names when a selected row takes them from its folder", () => {
    const name = col(projectCols, "name");
    expect(field(name, "keep", [onCreate, onUpdate])).toEqual(["import", "value"]);
    expect(field(name, "keep", [onCreate, { ...onUpdate, fromFolder: true }])).toBe("readOnly");
  });
});

describe("bulkEdit: actions", () => {
  it("only changes the selected rows", () => {
    const out = run(
      { action: "skip" },
      {
        selected: [2],
        decisions: { 4: { action: "create", targetId: "b" } },
        edits: { 4: { a: 1 } },
      },
    );
    expect(out.decisions[2]?.action).toBe("skip");
    expect(out.decisions[4]).toEqual({ action: "create", targetId: "b" });
    expect(out.decisions[3]).toBeUndefined();
    expect(out.edits).toEqual({ 4: { a: 1 } });
    expect(Object.keys(out.report)).toEqual(["2"]);
  });

  it("keeps a target through Create and Skip, for a later Update", () => {
    const decisions = { 5: { action: "update", targetId: "c" } as const };
    expect(run({ action: "create" }, { selected: [5], decisions }).decisions[5]).toEqual({
      action: "create",
      targetId: "c",
    });
    expect(run({ action: "skip" }, { selected: [5], decisions }).decisions[5]?.targetId).toBe("c");
  });

  it("Don't change leaves each row's action; a row on Skip is reported, not written", () => {
    const out = run(
      { fields: { location: { kind: "value", text: "Shelf" } } },
      { selected: [2, 3, 4] },
    );
    expect(actions(out)).toBe("create - update - -");
    expect(out.report).toEqual({ 2: "done", 3: "onSkip", 4: "done" });
    expect(out.edits).toEqual({ 2: { location: "Shelf" }, 4: { location: "Shelf" } });
  });

  it("Update goes to the row's own match; Use system match takes the suggested one", () => {
    const decisions = { 4: { action: "skip", targetId: "c" } as const };
    expect(run({ action: "update" }, { selected: [4], decisions }).decisions[4]?.targetId).toBe(
      "c",
    );
    expect(
      run({ action: "update", target: "system" }, { selected: [4], decisions }).decisions[4]
        ?.targetId,
    ).toBe("b");
  });

  it("Use system match under Don't change only touches rows on Update", () => {
    const decisions = {
      2: { action: "create", targetId: "c" },
      4: { action: "update", targetId: "c" },
    } as const;
    const out = run({ target: "system" }, { selected: [2, 4], decisions });
    expect(out.decisions[2]?.targetId).toBe("c");
    expect(out.decisions[4]?.targetId).toBe("b");
  });

  it("Use system match with no match of its own keeps a target you picked", () => {
    const decisions = { 5: { action: "skip", targetId: "c" } as const };
    const out = run({ action: "update", target: "system" }, { selected: [5], decisions });
    expect(out.decisions[5]).toEqual({ action: "update", targetId: "c" });
    expect(out.report).toEqual({ 5: "done" });
  });

  it("Use suggestion drops the picks and keeps the edits and what makes them count", () => {
    const decisions = {
      4: {
        action: "skip",
        targetId: "c",
        trackUsage: false,
        columnPolicies: { location: "overwrite", status: "fill" },
        refs: { spool: "s" },
      },
    } as const;
    const out = run(
      { action: "suggestion" },
      { selected: [4], decisions, edits: { 4: { location: "Shelf" } } },
    );
    expect(out.decisions[4]).toEqual({
      action: "update",
      targetId: "b",
      columnPolicies: { location: "overwrite" },
    });
    expect(out.edits[4]).toEqual({ location: "Shelf" });
  });

  it("Use suggestion sends a fixed invalid row to Create, or Update if it names a row", () => {
    const all = [invalid(2), invalid(3, "location", { targetId: "a" })];
    const edits = { 2: { location: "Shelf" }, 3: { location: "Shelf" } };
    expect(actions(run({ action: "suggestion" }, { all, edits }), all)).toBe("create update");
  });

  it("Use suggestion leaves a row whose edit is broken", () => {
    const all = [row(2, "changed", "a")];
    const decisions = { 2: { action: "create", targetId: "c" } as const };
    const edits = { 2: { pricePaid: "abc" } };
    const out = run({ action: "suggestion" }, { all, decisions, edits });
    expect(out.decisions[2]).toEqual(decisions[2]);
    expect(out.report).toEqual({ 2: "broken" });
  });
});

describe("bulkEdit: fields", () => {
  const value = (text: string) => ({ kind: "value", text }) as const;
  const decisions = {
    2: { action: "create", targetId: null },
    4: { action: "update", targetId: "b" },
  } as const;
  const selected = [2, 4];

  it("a value is an edit, and on an update also an overwrite", () => {
    const out = run({ fields: { location: value("Shelf") } }, { selected, decisions });
    expect(out.edits).toEqual({ 2: { location: "Shelf" }, 4: { location: "Shelf" } });
    expect(out.decisions[2]?.columnPolicies).toBeUndefined();
    expect(out.decisions[4]?.columnPolicies).toEqual({ location: "overwrite" });
  });

  it("Use import values undoes the edit; on an update it also overwrites", () => {
    const edits = { 2: { location: "x", status: "new" }, 4: { location: "y" } };
    const before = {
      2: { action: "create", targetId: null, columnPolicies: { location: "fill" } },
      4: decisions[4],
    } as const;
    const out = run(
      { fields: { location: { kind: "import" } } },
      { selected, decisions: before, edits },
    );
    expect(out.edits).toEqual({ 2: { status: "new" } });
    expect(out.decisions[2]?.columnPolicies).toEqual({});
    expect(out.decisions[4]?.columnPolicies).toEqual({ location: "overwrite" });
  });

  it("Use import values puts a pick back on the suggested one", () => {
    const all = [row(2, "new", null, { refs: { spool: "s1" } })];
    const out = run(
      { action: "create", fields: { spool: { kind: "import" } } },
      {
        all,
        columns: printCols,
        decisions: { 2: { action: "create", targetId: null, refs: { spool: "s2" } } },
      },
    );
    expect(out.decisions[2]?.refs).toEqual({ spool: "s1" });
  });

  it("the Update options undo the edit and set the column's merge", () => {
    const edits = { 4: { location: "y", status: "new" } };
    const out = run(
      {
        action: "update",
        fields: { location: { kind: "overwrite" }, status: { kind: "keepEdits" } },
      },
      { selected: [4], edits },
    );
    expect(out.edits[4]).toBeUndefined();
    expect(out.decisions[4]?.columnPolicies).toEqual({
      location: "overwrite",
      status: "keepEdits",
    });
  });

  it("Empty writes an empty cell on a create, and clears a pick", () => {
    const all = [row(2, "new", null, { refs: { spool: "s1" } })];
    const out = run(
      { action: "create", fields: { notes: { kind: "empty" }, spool: { kind: "empty" } } },
      { all, columns: printCols, preview: { refOptions: { spool: [] }, refsOptional: ["spool"] } },
    );
    expect(out.edits[2]).toEqual({ notes: null });
    expect(out.decisions[2]?.refs).toEqual({ spool: null });
  });

  it("a field the Action doesn't offer writes nothing", () => {
    const out = run(
      { action: "update", fields: { location: { kind: "empty" } } },
      { selected: [4] },
    );
    expect(out.edits).toEqual({});
    const skip = run({ action: "skip", fields: { location: value("x") } }, { selected: [2] });
    expect(skip.edits).toEqual({});
  });

  it("a locked field writes nothing", () => {
    const hidden = run({ action: "create", fields: { number: value("7") } }, { selected: [2, 4] });
    expect(hidden.edits).toEqual({});
    const locked = run({ action: "update", fields: { number: value("7") } }, { selected: [4] });
    expect(locked.edits).toEqual({});
    const reason = run(
      {
        action: "create",
        fields: { outcome: value("success"), failureReason: value("clog") },
      },
      { all: [row(2, "new")], columns: printCols },
    );
    expect(reason.edits[2]).toEqual({ outcome: "success" });
  });

  it("All columns sets every shown column it can; a single field can differ", () => {
    const out = run(
      { action: "update", all: "keepEdits", fields: { status: { kind: "overwrite" } } },
      { selected: [3, 4], shown: ["number", "location", "status", "colorName"] },
    );
    expect(out.decisions[4]?.columnPolicies).toEqual({
      location: "keepEdits",
      status: "overwrite",
      colorName: "keepEdits",
    });
  });

  it("All columns undoes edits, but not on a per-row column or Track usage", () => {
    const all = [row(2, "changed", "a"), row(3, "changed", "b")];
    const edits = { 2: { number: "9", title: "x" } };
    const decisions = { 2: { action: "update", targetId: "a", trackUsage: false } } as const;
    const out = run(
      { action: "update", all: "overwrite" },
      {
        all,
        columns: printCols,
        shown: ["number", "title", "trackUsage"],
        decisions,
        edits,
      },
    );
    expect(out.decisions[2]?.columnPolicies).toEqual({ title: "overwrite" });
    expect(out.decisions[2]?.trackUsage).toBe(false);
    expect(out.edits[2]).toBeUndefined(); // the number goes: an update can't take it
  });

  it("Track usage sets the tick, and import values gives it back to the row", () => {
    const all = [row(2, "new")];
    const set = (field: BulkForm["fields"][string]) =>
      run({ action: "create", fields: { trackUsage: field } }, { all, columns: printCols })
        .decisions[2]?.trackUsage;
    expect(set(value("no"))).toBe(false);
    expect(set(value("yes"))).toBe(true);
    expect(set({ kind: "import" })).toBeUndefined();
  });

  it("merges as the form said, end to end", () => {
    const columns = spoolCols;
    const file = { location: "Box", status: "new", colorName: "Red" };
    const onTarget = { location: "Drawer", status: "open", colorName: "Blue" };
    const all = [row(4, "changed", "b", { values: file, edited: ["location", "status"] })];
    const out = run(
      {
        action: "update",
        fields: { location: value("Shelf"), status: { kind: "keepEdits" } },
      },
      { all, shown: ["location", "status"] },
    );
    const d = out.decisions[4] as ImportDecision;
    const now = { ...file, ...out.edits[4] };
    // The value goes through even under Keep my edits; a kept edit stays; the rest is the row's.
    expect(
      mergeValues(columns, "keepEdits", now, onTarget, ["location", "status"], d.columnPolicies),
    ).toEqual({ location: "Shelf", colorName: "Red" });
    // Keep my edits with no known edits still means fill.
    expect(
      mergeValues(columns, "overwrite", file, { ...onTarget, status: null }, undefined, {
        status: "keepEdits",
        location: "keepEdits",
      }),
    ).toEqual({ status: "new", colorName: "Red" });
  });
});

describe("bulkEdit: per-row order", () => {
  const value = (text: string) => ({ kind: "value", text }) as const;

  it("a value fixes an invalid row, which then changes action", () => {
    const all = [invalid(2)];
    const out = run({ action: "create", fields: { location: value("Shelf") } }, { all });
    expect(out.decisions[2]?.action).toBe("create");
    expect(out.edits[2]).toEqual({ location: "Shelf" });
    expect(out.report).toEqual({ 2: "done" });
  });

  it("a row still broken keeps its action and the values, and stays selected", () => {
    const all = [invalid(2)];
    const out = run({ action: "create", fields: { colorName: value("Red") } }, { all });
    expect(out.decisions[2]?.action).toBe("skip");
    expect(out.edits[2]).toEqual({ colorName: "Red" });
    expect(out.report).toEqual({ 2: "broken" });
  });

  it("Skip doesn't move a broken row off its action either; on Skip already it is done", () => {
    const all = [row(2, "new"), invalid(3)];
    const edits = { 2: { pricePaid: "abc" } };
    const out = run({ action: "skip" }, { all, edits });
    expect(actions(out, all)).toBe("create skip");
    expect(out.report).toEqual({ 2: "broken", 3: "done" });
  });

  it("Don't change on an invalid row on Skip is reported, not fixed", () => {
    const all = [invalid(2), row(3, "new")];
    const out = run({ fields: { location: value("Shelf") } }, { all });
    expect(out.report[2]).toBe("onSkip");
    expect(out.edits[2]).toBeUndefined();
  });

  it("Update with no match: goes to Update, takes no values, stays selected", () => {
    const all = [row(2, "new"), row(3, "ambiguous")];
    const fields = { location: value("Shelf") };
    const out = run({ action: "update", target: "system", fields }, { all });
    expect(actions(out, all)).toBe("update update");
    expect(out.edits).toEqual({});
    expect(out.report).toEqual({ 2: "noMatch", 3: "noMatch" });
    // It can go to Create or Skip at once.
    const again = run({ action: "create" }, { all, decisions: out.decisions, edits: out.edits });
    expect(actions(again, all)).toBe("create create");
    expect(again.report).toEqual({ 2: "done", 3: "done" });
  });

  it("a broken row with no match doesn't go to Update", () => {
    const all = [invalid(2)];
    const out = run({ action: "update" }, { all });
    expect(out.decisions[2]?.action).toBe("skip");
    expect(out.report).toEqual({ 2: "broken" });
  });

  it("an update drops a number edit, which the server would refuse", () => {
    const edits = { 4: { number: "9", location: "x" } };
    const out = run({ action: "update" }, { selected: [4], edits });
    expect(out.edits[4]).toEqual({ location: "x" });
  });

  it("a number edit stays when the row can't go to Update without it", () => {
    const all = [invalid(2, "number", { targetId: "a" })];
    const edits = { 2: { number: "9" } };
    const out = run({ action: "update" }, { all, edits });
    expect(out.edits[2]).toEqual({ number: "9" });
    expect(out.decisions[2]?.action).toBe("skip");
    expect(out.report).toEqual({ 2: "broken" });
  });

  it("reports two rows on one target, counting rows not selected", () => {
    const all = [row(2, "changed", "a"), row(3, "changed", "a"), row(4, "changed", "b")];
    const out = run({ action: "update" }, { all, selected: [2, 4] });
    expect(out.report).toEqual({ 2: "duplicate", 4: "done" });
  });

  it("reports a required pick left empty", () => {
    const all = [row(2, "ambiguous", null, { refs: { project: null } })];
    const out = run(
      { action: "create" },
      { all, columns: printCols, preview: { refOptions: { project: [] } } },
    );
    expect(out.decisions[2]?.action).toBe("create");
    expect(out.report).toEqual({ 2: "needsRef" });
  });
});

describe("bulkEdit: picks", () => {
  const spools = [
    { id: "s1", label: "Spool 1" },
    { id: "late", label: "Late", from: "2026-06-01" },
    { id: "gone", label: "Gone", empty: true },
  ];
  const preview = {
    refOptions: {
      project: [
        { id: NO_PROJECT, label: "" },
        { id: "p1", label: "01-Box" },
      ],
      spool: spools,
      spool2: spools,
    },
    refsOptional: ["spool", "spool2"],
  };
  const pick = (id: string, text = id) => ({ kind: "value", text, id }) as const;
  const startedAt = "2026-01-15T12:00:00Z";
  // The server only names a slot's spool in `refs` when the slot has grams.
  const created = (refs: Record<string, string | null>) =>
    row(2, "new", null, {
      refs,
      values: {
        startedAt,
        ...("spool" in refs && { grams: 10 }),
        ...("spool2" in refs && { grams2: 10 }),
      },
    });
  const opts = (all: ImportPreviewRow[], more = {}) => ({
    all,
    columns: printCols,
    preview,
    ...more,
  });

  it("a spool goes to each slot it fits, on a create as a ref id", () => {
    const out = run(
      { action: "create", fields: { spool: pick("s1"), spool2: pick("s1") } },
      opts([created({ spool: null, spool2: null })]),
    );
    expect(out.decisions[2]?.refs).toEqual({ spool: "s1", spool2: "s1" });
    expect(out.edits).toEqual({});
    expect(out.report).toEqual({ 2: "done" });
  });

  it("a spool that doesn't fit leaves that cell, reports it, and writes the rest", () => {
    for (const id of ["late", "gone", "other"]) {
      const out = run(
        { action: "create", fields: { spool: pick(id), notes: { kind: "value", text: "n" } } },
        opts([created({ spool: "s1" })]),
      );
      expect(out.decisions[2]?.refs).toEqual({ spool: "s1" });
      expect(out.decisions[2]?.action).toBe("create");
      expect(out.edits[2]).toEqual({ notes: "n" });
      expect(out.report).toEqual({ 2: "noFit" });
    }
  });

  it("a spool added in this review fits like the picker's", () => {
    const form = { action: "create", fields: { spool: pick("new1") } } as const;
    const all = [created({ spool: null })];
    const out = bulkEdit({
      preview: { rows: all, targets, ...preview },
      columns: printCols,
      shown: [],
      selected: [2],
      decisions: {},
      edits: {},
      added: [{ id: "new1", label: "New" }],
      form,
    });
    expect(out.decisions[2]?.refs).toEqual({ spool: "new1" });
  });

  it("a slot the row doesn't have doesn't fit", () => {
    const out = run(
      { action: "create", fields: { spool2: pick("s1") } },
      opts([created({ spool: null })]),
    );
    expect(out.report).toEqual({ 2: "noFit" });
    expect(out.decisions[2]?.refs).toEqual({ spool: null });
  });

  it("on an update a spool is a name edit that overwrites, taking the print's grams", () => {
    const withTarget = { targets: [target("a", { grams: 12, spool: null })] };
    const all = [row(2, "changed", "a", { values: { startedAt } })];
    const out = bulkEdit({
      preview: { rows: all, ...withTarget, ...preview },
      columns: printCols,
      shown: [],
      selected: [2],
      decisions: {},
      edits: {},
      form: { action: "update", fields: { spool: pick("s1", "Spool 1") } },
    });
    expect(out.edits[2]).toEqual({ spool: "Spool 1", grams: "12" });
    expect(out.decisions[2]?.columnPolicies).toEqual({ spool: "overwrite" });
    expect(out.report).toEqual({ 2: "done" });
  });

  it("on an update a slot without grams doesn't fit, unless the form gives them", () => {
    const all = [row(2, "changed", "a", { values: { startedAt } })];
    const form = { action: "update", fields: { spool: pick("s1") } } as const;
    expect(run(form, opts(all)).report).toEqual({ 2: "noFit" });
    const out = run(
      { action: "update", fields: { spool: pick("s1"), grams: { kind: "value", text: "5" } } },
      opts(all),
    );
    expect(out.edits[2]).toEqual({ spool: "s1", grams: "5" });
    expect(out.report).toEqual({ 2: "done" });
  });

  it("a project: a ref id on a row that picks it, a name edit on one that names it", () => {
    const fields = { project: pick("p1", "01-Box") };
    const picks = run({ action: "create", fields }, opts([created({ project: null })]));
    expect(picks.decisions[2]?.refs).toEqual({ project: "p1" });
    const names = run({ action: "create", fields }, opts([created({})]));
    expect(names.edits[2]).toEqual({ project: "01-Box" });
    const update = run({ action: "update", fields }, opts([row(2, "changed", "a")]));
    expect(update.edits[2]).toEqual({ project: "01-Box" });
    expect(update.decisions[2]?.columnPolicies).toEqual({ project: "overwrite" });
  });

  it("No project goes only to a row that picks: an empty cell can't clear a value", () => {
    const fields = { project: pick(NO_PROJECT, "") };
    const picks = run({ action: "create", fields }, opts([created({ project: null })]));
    expect(picks.decisions[2]?.refs).toEqual({ project: NO_PROJECT });
    expect(picks.report).toEqual({ 2: "done" });
    expect(run({ action: "create", fields }, opts([created({})])).report).toEqual({ 2: "noFit" });
    const update = run({ action: "update", fields }, opts([row(2, "changed", "a")]));
    expect(update.report).toEqual({ 2: "noFit" });
    expect(update.edits).toEqual({});
  });

  it("a fixed invalid row has no picks, so a spool doesn't fit it", () => {
    const all = [invalid(2, "title", { values: { startedAt } })];
    const out = run(
      { action: "create", fields: { spool: pick("s1"), title: { kind: "value", text: "T" } } },
      opts(all),
    );
    expect(out.decisions[2]?.action).toBe("create");
    expect(out.report).toEqual({ 2: "noFit" });
  });
});

describe("bulkEdit: folders", () => {
  const root = "/mnt/new";
  const project = (n: number, path: string, extra: Partial<ImportPreviewRow> = {}) =>
    row(n, "new", null, { values: { name: "P", folder: path }, ...extra });
  const opts = (all: ImportPreviewRow[], more = {}) => ({ all, columns: projectCols, ...more });
  const outside = (n: number) =>
    project(n, "/old/007_x", {
      status: "invalid",
      action: "skip",
      errors: [{ column: "folder", code: "outside_roots" }],
    });

  it("moves each folder to the root, keeping its own last folder", () => {
    const all = [project(2, "/a/001_x"), project(3, "C:\\b\\002_y")];
    const out = run({ folder: { kind: "moveToRoot", root } }, opts(all));
    expect(out.decisions[2]?.folder).toEqual({ path: "/mnt/new/001_x" });
    expect(out.decisions[3]?.folder).toEqual({ path: "/mnt/new/002_y" });
    expect(out.edits).toEqual({});
    expect(out.folders).toEqual([
      { row: 2, targetId: null, folder: "/mnt/new/001_x" },
      { row: 3, targetId: null, folder: "/mnt/new/002_y" },
    ]);
  });

  it("a row with no folder can't move: reported, nothing asked", () => {
    const out = run(
      { folder: { kind: "moveToRoot", root } },
      opts([row(2, "new", null, { values: { name: "P" } })]),
    );
    expect(out.report).toEqual({ 2: "noFit" });
    expect(out.folders).toEqual([]);
  });

  it("a move fixes a row whose only error is its folder, and it goes to Create", () => {
    const out = run({ folder: { kind: "moveToRoot", root } }, opts([outside(2)]));
    expect(out.decisions[2]).toMatchObject({
      action: "create",
      folder: { path: "/mnt/new/007_x" },
    });
    expect(out.edits[2]).toEqual({ folder: "/mnt/new/007_x" });
    expect(out.report).toEqual({ 2: "done" });
  });

  it("a typed path, No folder and Create folder fix it too", () => {
    const go = (folder: BulkForm["folder"]) => run({ folder }, opts([outside(2)]));
    expect(go({ kind: "path", path: "/mnt/new/z" }).edits[2]).toEqual({ folder: "/mnt/new/z" });
    const none = go({ kind: "none" });
    expect(none.decisions[2]).toMatchObject({ action: "create", folder: null });
    expect(none.edits[2]).toEqual({ folder: null });
    const made = go({ kind: "create", name: "z", rootId: "r" });
    expect(made.decisions[2]?.folder).toEqual({ create: true, name: "z", rootId: "r" });
    expect(made.report).toEqual({ 2: "done" });
  });

  it("Use import values doesn't fix it, and any other error isn't fixed by a move", () => {
    const back = run({ folder: { kind: "import" } }, opts([outside(2)]));
    expect(back.report).toEqual({ 2: "onSkip" });
    const other = run(
      { folder: { kind: "moveToRoot", root } },
      opts([invalid(2, "name", { values: { folder: "/a/x" } })]),
    );
    expect(other.report).toEqual({ 2: "onSkip" });
  });

  it("Use import values gives the row its own folder back, and clears From folder", () => {
    const all = [project(2, "/a/001_x")];
    const decisions = {
      2: { action: "create", targetId: null, folder: { path: "/b/y" }, fromFolder: true },
    } as const;
    const out = run({ folder: { kind: "import" } }, opts(all, { decisions }));
    expect(out.decisions[2]?.folder).toBeUndefined();
    expect(out.decisions[2]?.fromFolder).toBeUndefined();
    expect(out.folders).toEqual([{ row: 2, targetId: null, folder: "/a/001_x" }]);
  });

  it("asks again only for rows whose folder changed, with their target on an update", () => {
    const all = [
      project(2, "/mnt/new/001_x"),
      row(3, "changed", "a", { values: { name: "P", folder: "/a/002_y" } }),
    ];
    const out = run({ folder: { kind: "moveToRoot", root } }, opts(all));
    expect(out.folders).toEqual([{ row: 3, targetId: "a", folder: "/mnt/new/002_y" }]);
  });

  it("Use suggestion drops a picked folder and asks again", () => {
    const decisions = { 2: { action: "create", targetId: null, folder: null } } as const;
    const out = run(
      { action: "suggestion", folder: { kind: "none" } },
      opts([project(2, "/a/001_x")], { decisions }),
    );
    expect(out.decisions[2]?.folder).toBeUndefined();
    expect(out.folders).toEqual([{ row: 2, targetId: null, folder: "/a/001_x" }]);
  });

  it("Skip ignores the folder field", () => {
    const out = run(
      { action: "skip", folder: { kind: "moveToRoot", root } },
      opts([project(2, "/a/001_x")]),
    );
    expect(out.decisions[2]?.folder).toBeUndefined();
  });

  it("no values for a from-folder row's names", () => {
    const all = [project(2, "/a/001_x"), project(3, "/a/002_y")];
    const decisions = { 2: { action: "create", targetId: null, fromFolder: true } } as const;
    const out = run(
      { fields: { description: { kind: "value", text: "d" } } },
      opts(all, { decisions }),
    );
    expect(out.edits).toEqual({});
  });

  it("joins a folder to a root with the root's separator", () => {
    expect(lastFolder("C:\\Users\\me\\projects\\001_aqua")).toBe("001_aqua");
    expect(lastFolder("/volume1/projects/001_aqua/")).toBe("001_aqua");
    expect(lastFolder("/")).toBe("");
    expect(inRoot("D:\\prints\\", "001_aqua")).toBe("D:\\prints\\001_aqua");
    expect(inRoot("/mnt/p", "001_aqua")).toBe("/mnt/p/001_aqua");
  });
});

// Each preset that goes away, as selected rows plus a form. Row 6 is invalid: it never changes.
describe("bulkEdit: the old presets' flows", () => {
  const byStatus = (...s: ImportStatus[]) =>
    rows.filter((r) => s.includes(r.status)).map((r) => r.row);

  it("All new: select all, Create", () => {
    expect(actions(run({ action: "create" }))).toBe("create create create create skip");
  });

  it("Skip all: select all, Skip", () => {
    expect(actions(run({ action: "skip" }))).toBe("skip skip skip skip skip");
  });

  it("Only new: the new rows on Create, the others on Skip", () => {
    const first = run({ action: "create" }, { selected: byStatus("new") });
    const out = run(
      { action: "skip" },
      { selected: byStatus("identical", "changed", "ambiguous"), decisions: first.decisions },
    );
    expect(actions(out)).toBe("create skip skip skip -");
  });

  it("Only changed: the changed rows on Update, the others on Skip", () => {
    const first = run({ action: "update" }, { selected: byStatus("changed") });
    const out = run(
      { action: "skip" },
      { selected: byStatus("new", "identical", "ambiguous"), decisions: first.decisions },
    );
    expect(actions(out)).toBe("skip skip update skip -");
  });

  it("Update matched: Update; rows with no match are reported instead of skipped", () => {
    const out = run(
      { action: "update" },
      { selected: byStatus("new", "identical", "changed", "ambiguous") },
    );
    expect(actions(out)).toBe("update update update update -");
    expect(out.report).toEqual({ 2: "noMatch", 3: "done", 4: "done", 5: "noMatch" });
    // The ones you meant to leave out go to Skip at once.
    const skipped = run({ action: "skip" }, { selected: [2, 5], decisions: out.decisions });
    expect(actions(skipped)).toBe("skip update update skip -");
  });

  it("Auto match and Reset: Use suggestion", () => {
    expect(actions(run({ action: "suggestion" }))).toBe("create skip update skip skip");
    const moved = run({ action: "skip" }, { selected: [2, 4] });
    const back = run({ action: "suggestion" }, { decisions: moved.decisions });
    expect(actions(back)).toBe("create skip update skip skip");
    expect(back.decisions[4]?.targetId).toBe("b");
  });
});
