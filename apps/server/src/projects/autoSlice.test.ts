import type { ProjectModel } from "@3d-maker-suite/core";
import { describe, expect, it } from "vitest";
import { classify } from "./autoSlice.ts";

/** A model whose plates use slots 1..n, one entry per plate. */
const model = (...slots: number[]) =>
  ({
    plates: slots.map((n, i) => ({
      index: i + 1,
      filaments: Array.from({ length: n }, (_, s) => ({ slot: s + 1 })),
    })),
  }) as unknown as ProjectModel;
const row = (plate: number, slots: number) => ({ plate, filaments: Array(slots).fill(null) });

describe("classify", () => {
  it("same plates and slots: every saved plate slices", () => {
    expect(classify(model(2, 1), model(2, 1), [row(1, 2), row(2, 1)])).toEqual({
      slice: [1, 2],
      changed: false,
    });
    // Fewer slots than the setup maps is still fine.
    expect(classify(model(2), model(1), [row(1, 2)])).toEqual({ slice: [1], changed: false });
  });

  it("a plate added: changed, the saved plates still slice", () => {
    expect(classify(model(1), model(1, 1), [row(1, 1)])).toEqual({ slice: [1], changed: true });
  });

  it("a plate removed or the file gone: changed, nothing of the file slices", () => {
    // Plate 2 removed: plate 1 may now be the old plate 2 (renumbered), so not even that.
    expect(classify(model(1, 1), model(1), [row(1, 1)])).toEqual({ slice: [], changed: true });
    expect(classify(model(1, 1), model(1, 1, 1), [row(3, 1)]).changed).toBe(true);
    expect(classify(model(1), undefined, [row(1, 1)])).toEqual({ slice: [], changed: true });
  });

  it("a saved plate gained a slot: changed, only the other plates slice", () => {
    expect(classify(model(2, 1), model(3, 1), [row(1, 2), row(2, 1)])).toEqual({
      slice: [2],
      changed: true,
    });
  });
});
