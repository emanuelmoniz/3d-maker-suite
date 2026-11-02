import { createHash } from "node:crypto";

// Slicer presets as the hub and connectors compare them (ADR-0017).

const NAME_MAX = 200;

const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
        )
      : v;

/** Of the canonical json: sorted keys, no whitespace. The clouds re-serialize, so bytes don't compare. */
export const presetSha = (json: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sorted(json)))
    .digest("hex");

/** The json object in `text`, or null. `"nil"` values are valid: they inherit. */
export function parsePreset(text: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(text);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The `name` inside it; a missing or oversized one falls back to the file's name. */
export const presetName = (json: Record<string, unknown> | null, fileName: string) =>
  typeof json?.name === "string" && json.name && json.name.length <= NAME_MAX
    ? json.name
    : fileName;
