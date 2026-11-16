import type { LibrarySpool } from "@3d-maker-suite/core";
import { z } from "zod";

// Spoolman's answers and what they become. Pure: no requests here (index.ts makes them).
// Only the fields the app reads are described; everything else is ignored, and kept as it is.

const num = z.number().nullish();

export const vendorSchema = z.object({ id: z.number(), name: z.string() });

export const filamentSchema = z.object({
  id: z.number(),
  name: z.string().nullish(),
  vendor: vendorSchema.nullish(),
  material: z.string().nullish(),
  density: num,
  /** g of filament on a full spool. */
  weight: num,
  /** g of the empty spool. */
  spool_weight: num,
  /** "29B2B2", no `#`. */
  color_hex: z.string().nullish(),
  /** "29B2B2,FFFFFF" for a multi-colour filament. */
  multi_color_hexes: z.string().nullish(),
});

export const spoolSchema = z.object({
  id: z.number(),
  filament: filamentSchema,
  initial_weight: num,
  spool_weight: num,
  remaining_weight: num,
  used_weight: z.number(),
  archived: z.boolean().nullish(),
  /** Every value is JSON text (a text field's is a quoted string). */
  extra: z.record(z.string(), z.string()).nullish(),
});
export type SpoolmanSpool = z.infer<typeof spoolSchema>;

export const fieldSchema = z.object({ key: z.string() });

/** The extra field on Spoolman's spools that says what the app wrote there. */
export const FIELD = "maker_suite";
/** Keys kept on one spool's marker: enough for any retry, small next to Spoolman's own fields. */
export const KEEP_KEYS = 200;

/**
 * What the app wrote to one spool: the grams it holds per print slot (`<printId>:<slot>`), and the
 * app's spool when the app made it. Written in the same request as the weight it explains.
 */
export type Marker = { charges: Record<string, number>; spool?: string };

/** The spool's marker, or an empty one (nothing written yet, or a value someone else typed). */
export function markerOf(spool: Pick<SpoolmanSpool, "extra">): Marker {
  const raw = spool.extra?.[FIELD];
  if (!raw) return { charges: {} };
  try {
    // A text field holds a JSON string, which holds the marker's JSON.
    const text = JSON.parse(raw);
    const m = z
      .object({
        charges: z.record(z.string(), z.number()).default({}),
        spool: z.string().optional(),
      })
      .safeParse(typeof text === "string" ? JSON.parse(text) : text);
    return m.success ? m.data : { charges: {} };
  } catch {
    return { charges: {} };
  }
}

/** The marker as the field's value: JSON text of a JSON string. */
export const markerValue = (m: Marker) => JSON.stringify(JSON.stringify(m));

/**
 * The marker with `key` holding `grams`, the newest last: the oldest go past `KEEP_KEYS` (the
 * server still knows what it sent for those, so it never needs them back).
 */
export function withCharge(m: Marker, key: string, grams: number): Marker {
  const { [key]: _old, ...rest } = m.charges;
  const entries = [...Object.entries(rest), [key, grams] as const];
  return { ...m, charges: Object.fromEntries(entries.slice(-KEEP_KEYS)) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "29b2b2" or "#29B2B2" -> "#29b2b2"; anything else -> grey. */
export function hex(c?: string | null) {
  const m = c?.trim().match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  return m ? `#${m[1]?.toLowerCase()}` : "#808080";
}

/** A Spoolman spool as the app's spool import reads it. */
export function toLibrarySpool(s: SpoolmanSpool): LibrarySpool {
  const f = s.filament;
  const initial = s.initial_weight ?? f.weight ?? null;
  const remaining = s.remaining_weight ?? (initial != null ? initial - s.used_weight : null);
  return {
    spoolId: String(s.id),
    filament: {
      brand: f.vendor?.name.trim() ?? "",
      // The app's spools always have a material; Spoolman's may not.
      material: f.material?.trim() || "Unknown",
      name: f.name?.trim() ?? "",
    },
    colorHex: hex(f.color_hex ?? f.multi_color_hexes?.split(",")[0]),
    // Spoolman has no colour name.
    colorName: null,
    initialGrams: initial != null ? round2(initial) : null,
    remainingGrams: remaining != null ? round2(Math.max(0, remaining)) : null,
    emptyWeightGrams: s.spool_weight ?? f.spool_weight ?? null,
    status: remaining != null && remaining <= 0 ? "empty" : s.used_weight > 0 ? "in_use" : "new",
  };
}

const same = (a?: string | null, b?: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** The filament of a vendor (or none) with this material, name and colour, if Spoolman has it. */
export const findFilament = (
  all: z.infer<typeof filamentSchema>[],
  want: { vendorId: number | null; material: string; name: string; colorHex: string },
) =>
  all.find(
    (f) =>
      (f.vendor?.id ?? null) === want.vendorId &&
      same(f.material, want.material) &&
      same(f.name, want.name) &&
      hex(f.color_hex) === hex(want.colorHex),
  );
