import { Buffer } from "node:buffer";
import { XMLParser } from "fast-xml-parser";
import { openZip } from "./zip.ts";

/** The grams a slicer wrote for one filament; `slot` only where the file says which one it is. */
export interface JobTotal {
  slot?: number;
  grams: number;
}

// Where each slicer keeps them (packages/3mf/fixtures/job-headers/SOURCE.md): Orca and Prusa near
// the end of the G-code, a .bgcode in its first block, Bambu Studio at the top of its G-code.
// ponytail: 64 KB from each end; Prusa's totals sat 11 KB from the end. Widen if a slicer writes
// more config after them.
const WINDOW = 64 * 1024;
const list = (text: string, key: RegExp) => {
  const m = key.exec(text)?.[1];
  return m?.split(",").map((v) => Number(v.trim()));
};

/**
 * The slicer totals in a job file: a `.gcode.3mf` (its `slice_info.config`), a G-code or a
 * `.bgcode`, whole or as its first and last bytes joined. Empty when the file has none.
 */
export async function readJobTotals(bytes: Uint8Array): Promise<JobTotal[]> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return fromSliceInfo(bytes);
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  const ends =
    bytes.length > 2 * WINDOW
      ? `${text(bytes.subarray(0, WINDOW))}\n${text(bytes.subarray(bytes.length - WINDOW))}`
      : text(bytes);
  // Orca, Prusa, bgcode: one value per filament, position = tool. Not the "total ..." line.
  const tools = list(ends, /(?<!total )filament used \[g\]\s*=\s*([\d.,\s]+)/);
  if (tools)
    return tools.flatMap((grams, slot) => (Number.isFinite(grams) ? [{ slot, grams }] : []));
  // Bambu Studio: only the filaments used, so a position is not a slot.
  const used = list(ends, /total filament weight \[g\]\s*:\s*([\d.,\s]+)/);
  return used?.filter(Number.isFinite).map((grams) => ({ grams })) ?? [];
}

async function fromSliceInfo(bytes: Uint8Array): Promise<JobTotal[]> {
  const zip = await openZip(bytes);
  try {
    const xml = await zip.read("Metadata/slice_info.config");
    if (!xml) return [];
    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(
      xml.toString("utf8"),
    );
    // A .gcode.3mf holds one plate.
    const plate = [doc.config?.plate].flat()[0];
    // ponytail: the file's filament id minus 1 is the slot; right until the AMS mapping moves it.
    return [plate?.filament ?? []].flat().flatMap((f: Record<string, string>) => {
      const grams = Number(f.used_g);
      const slot = Number(f.id) - 1;
      return Number.isFinite(grams) && Number.isInteger(slot) && slot >= 0 ? [{ slot, grams }] : [];
    });
  } finally {
    zip.close();
  }
}
