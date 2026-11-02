import { createHash } from "node:crypto";
import { EOL } from "node:os";

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

/** The slicer's own style (sorted keys, its indent), so a file's bytes survive a cloud round trip. */
export const presetText = (json: unknown, indent: string, eol = EOL) =>
  JSON.stringify(sorted(json), null, indent).replaceAll("\n", eol) + eol;

// ponytail: two names that differ only in these characters share a file; the later write wins.
/** A preset's file: its name can't leave the folder or break on any OS. */
export const presetFileName = (name: string) =>
  `${name.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").replace(/[. ]+$/, "") || "preset"}.json`;

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
