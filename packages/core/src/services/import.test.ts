import { describe, expect, it } from "vitest";
import {
  IMPORT_COLUMNS,
  type ImportColumn,
  type ImportPreviewRow,
  type ImportStatus,
} from "../schemas/import.ts";
import {
  applyBulk,
  autoDecisions,
  autoOf,
  type BULK_ACTIONS,
  diffValues,
  headerKeys,
  mergeValues,
  parseCell,
  parseCsv,
  parseRow,
  suggest,
} from "./import.ts";
import { matchRowsOn } from "./importMatch.ts";

const columns = IMPORT_COLUMNS.spools;
const col = (key: string) => columns.find((c) => c.key === key) as ImportColumn;

describe("parseCsv", () => {
  it("detects the delimiter from the header line", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a;b\r\n1,5;2\r\n")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads quoted cells and drops the BOM", () => {
    expect(parseCsv('﻿a,b\n"x, ""y""","line\nbreak"\n')).toEqual([
      ["a", "b"],
      ['x, "y"', "line\nbreak"],
    ]);
  });
});

describe("headerKeys", () => {
  it("matches the key or the translated label, ignoring case and punctuation", () => {
    expect(
      headerKeys(columns, ["Material *", "initialgrams", "Peso vazio (g)", "Notes", ""], {
        material: "Material",
        emptyWeightGrams: "Peso vazio (g)",
      }),
    ).toEqual(["material", "initialGrams", "emptyWeightGrams", null, null]);
  });
});

describe("parseCell", () => {
  it("reads numbers with a decimal comma or point", () => {
    const grams = col("initialGrams");
    expect(parseCell(grams, 750)).toEqual({ value: 750 });
    expect(parseCell(grams, " 12,5 ")).toEqual({ value: 12.5 });
    expect(parseCell(grams, "1.234,56")).toEqual({ value: 1234.56 });
    expect(parseCell(grams, "1,234.56")).toEqual({ value: 1234.56 });
    expect(parseCell(grams, "abc")).toEqual({ error: "not_a_number" });
    expect(parseCell(grams, "-5")).toEqual({ error: "negative" });
    expect(parseCell(grams, "")).toEqual({ error: "required" });
  });

  it("keeps money in minor units", () => {
    expect(parseCell(col("pricePaid"), "19,99")).toEqual({ value: 1999 });
    expect(parseCell(col("pricePaid"), 24.9)).toEqual({ value: 2490 });
  });

  it("takes ISO dates only", () => {
    const date = col("purchasedAt");
    expect(parseCell(date, "2026-03-04")).toEqual({ value: "2026-03-04" });
    expect(parseCell(date, "2026-03-04T00:00:00.000Z")).toEqual({ value: "2026-03-04" });
    expect(parseCell(date, "03/04/2026")).toEqual({ error: "not_a_date" });
    expect(parseCell(date, "2026-13-40")).toEqual({ error: "not_a_date" });
    expect(parseCell(date, null)).toEqual({ value: null });
  });

  it("normalises colours and options", () => {
    expect(parseCell(col("colorHex"), "FF8800")).toEqual({ value: "#ff8800" });
    expect(parseCell(col("colorHex"), "orange")).toEqual({ error: "not_a_color" });
    expect(parseCell(col("status"), "In use")).toEqual({ value: "in_use" });
    expect(parseCell(col("status"), "gone")).toEqual({ error: "not_an_option" });
  });
});

it("parseRow lists every error and leaves the bad cells empty", () => {
  expect(parseRow(columns, { material: "PLA", initialGrams: "x", colorHex: "red" })).toMatchObject({
    values: { material: "PLA", initialGrams: null, colorHex: null, brand: null },
    errors: [
      { column: "colorHex", code: "not_a_color" },
      { column: "initialGrams", code: "not_a_number" },
    ],
  });
});

describe("diff and merge", () => {
  const target = { brand: "Acme", material: "PLA", initialGrams: 1000, location: null };
  const file = {
    brand: "acme",
    material: "PLA",
    initialGrams: 750,
    location: "Shelf",
    status: null,
  };

  it("an empty file cell is never a difference; names ignore case", () => {
    expect(diffValues(columns, file, target)).toEqual(["initialGrams", "location"]);
  });

  it("overwrite takes the file's values; fill only the fields that are empty", () => {
    expect(mergeValues(columns, "overwrite", file, target)).toEqual({
      initialGrams: 750,
      location: "Shelf",
    });
    expect(mergeValues(columns, "fill", file, target)).toEqual({ location: "Shelf" });
  });
});

it("suggest never guesses", () => {
  const row = { values: { material: "PLA", location: "Shelf" }, errors: [] };
  const fits = (candidates: string[], target: Record<string, string> | null) =>
    suggest(columns, row, { candidates, target });
  expect(suggest(columns, { ...row, errors: [1] }, { candidates: ["a"], target: {} })).toEqual({
    status: "invalid",
    action: "skip",
  });
  expect(fits([], null)).toEqual({ status: "new", action: "create" });
  expect(fits(["a", "b"], null)).toEqual({ status: "ambiguous", action: "skip" });
  expect(fits(["a"], { material: "PLA", location: "Box" })).toEqual({
    status: "changed",
    action: "update",
  });
  expect(fits(["a"], { material: "PLA", location: "Shelf" })).toEqual({
    status: "identical",
    action: "skip",
  });
});

describe("applyBulk", () => {
  const row = (n: number, status: ImportStatus, targetId: string | null = null) =>
    ({
      row: n,
      status,
      targetId,
      candidates: [],
      values: {},
      errors: [],
      action: status === "new" ? "create" : status === "changed" ? "update" : "skip",
    }) satisfies ImportPreviewRow;
  const rows = [
    row(2, "new"),
    row(3, "identical", "a"),
    row(4, "changed", "b"),
    row(5, "ambiguous"),
    row(6, "invalid"),
  ];
  const actions = (bulk: (typeof BULK_ACTIONS)[number], scope = rows, before = {}) => {
    const out = applyBulk(scope, before, bulk);
    return rows.map((r) => out[r.row]?.action ?? "-").join(" ");
  };

  it("sets each row's action; invalid rows never change", () => {
    expect(actions("allNew")).toBe("create create create create -");
    expect(actions("autoMatch")).toBe("create skip update skip -");
    expect(actions("onlyNew")).toBe("create skip skip skip -");
    expect(actions("onlyChanged")).toBe("skip skip update skip -");
    expect(actions("updateMatched")).toBe("skip update update skip -");
    expect(actions("skipAll")).toBe("skip skip skip skip -");
  });

  it("only touches the rows in scope (selected or filtered)", () => {
    expect(actions("skipAll", rows.slice(0, 2))).toBe("skip skip - - -");
  });

  it("a picked target counts as a match and survives everything but reset", () => {
    const picked = { 5: { action: "skip", targetId: "c", policy: "fill" } } as const;
    expect(applyBulk(rows, picked, "autoMatch")[5]).toEqual({
      action: "update",
      targetId: "c",
      policy: "fill",
    });
    expect(applyBulk(rows, picked, "allNew")[5]).toMatchObject({ targetId: "c" });
    expect(applyBulk(rows, picked, "reset")).toEqual({});
  });
});

describe("auto mode", () => {
  const facts = { linked: false, held: false, optional: false };

  it("takes a new row and a changed one from the same source; the rest waits", () => {
    expect(autoOf({ ...facts, status: "new" })).toBe("apply");
    expect(autoOf({ ...facts, status: "changed", linked: true })).toBe("apply");
    // Matched to a row made by hand: a person decides.
    expect(autoOf({ ...facts, status: "changed" })).toBe("wait");
    expect(autoOf({ ...facts, status: "ambiguous" })).toBe("wait");
    // It would add a brand, or no single profile fits.
    expect(autoOf({ ...facts, status: "new", held: true })).toBe("wait");
  });

  it("has nothing to do with identical, invalid or only-offered rows", () => {
    expect(autoOf({ ...facts, status: "identical", linked: true })).toBeUndefined();
    expect(autoOf({ ...facts, status: "invalid" })).toBeUndefined();
    expect(autoOf({ ...facts, status: "new", optional: true })).toBeUndefined();
  });

  it("decides only the rows to apply, with their suggestion", () => {
    const row = (over: Partial<ImportPreviewRow>): ImportPreviewRow => ({
      row: 2,
      values: {},
      status: "new",
      errors: [],
      targetId: null,
      candidates: [],
      action: "create",
      auto: "apply",
      ...over,
    });
    expect(
      autoDecisions([
        row({ refs: { profile: "p1" } }),
        row({ row: 3, status: "changed", action: "update", targetId: "t1" }),
        row({ row: 4, auto: "wait" }),
        row({ row: 5, auto: undefined }),
      ]),
    ).toEqual([
      { row: 2, action: "create", targetId: undefined, refs: { profile: "p1" } },
      { row: 3, action: "update", targetId: "t1", refs: {} },
    ]);
  });
});

it("matchRowsOn fits rows on the named columns, ignoring case", () => {
  const targets = [
    { id: "a", label: "a", values: { brand: "Acme", model: "X" } },
    { id: "b", label: "b", values: { brand: "Acme", model: "Y" } },
  ];
  expect(
    matchRowsOn("brand", "model")(
      [
        { brand: "ACME", model: "x" },
        { brand: "Acme", model: "Z" },
      ],
      targets,
    ),
  ).toEqual([
    { candidates: ["a"], targetId: "a" },
    { candidates: [], targetId: null },
  ]);
});
