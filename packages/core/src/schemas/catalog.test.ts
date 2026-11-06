import { expect, it } from "vitest";
import { modelLabel, spoolFilament } from "./catalog.ts";

it("names a model with its brand once", () => {
  expect(modelLabel("Bambu Lab", "Bambu Lab A1")).toBe("Bambu Lab A1");
  expect(modelLabel("Bambu Lab", "bambu lab a1 mini")).toBe("bambu lab a1 mini");
  expect(modelLabel("Prusa", "MK4")).toBe("Prusa MK4");
  expect(modelLabel("Bambu", "Bambulab X1")).toBe("Bambu Bambulab X1"); // a prefix, not the word
  expect(modelLabel(undefined, "X1")).toBe("X1");
  expect(modelLabel("Unknown", "Unknown")).toBe("Unknown");
});

it("names a spool's filament: brand, then the material unless the name starts with it", () => {
  expect(spoolFilament({ brand: "Bambu Lab", material: "PLA", name: "PLA Basic" })).toBe(
    "Bambu Lab PLA Basic",
  );
  expect(spoolFilament({ brand: "Prusament", material: "PETG", name: "Galaxy" })).toBe(
    "Prusament PETG Galaxy",
  );
  expect(spoolFilament({ brand: "", material: "PLA", name: null })).toBe("PLA");
});
