// Prints the GitHub release notes for a version: `node scripts/release-notes.mjs 5.1.0` (or v5.1.0).
// A pre-release gets its own CHANGELOG section. A stable release gets its section plus every
// pre-release section since the previous stable, merged per heading, so the notes list everything
// that differs from the last stable release.
import { readFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
const text = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const sections = text
  .split(/^## \[/m)
  .slice(1)
  .map((s) => ({ version: s.slice(0, s.indexOf("]")), body: s.slice(s.indexOf("\n") + 1).trim() }));

const i = sections.findIndex((s) => s.version === version);
if (i < 0) {
  console.error(`No CHANGELOG section for ${version}`);
  process.exit(1);
}
const stable = !version.includes("-");
const range = [sections[i]];
if (stable) {
  for (let j = i + 1; j < sections.length && sections[j].version.includes("-"); j++)
    range.push(sections[j]);
}

// Split a body into its intro (text before the first ###) and bullets per heading.
const groups = new Map();
for (const { body } of range) {
  for (const part of body.split(/^### /m).slice(1)) {
    const name = part.slice(0, part.indexOf("\n")).trim();
    groups.set(name, [...(groups.get(name) ?? []), part.slice(part.indexOf("\n") + 1).trim()]);
  }
}
const intro = sections[i].body.split(/^### /m)[0].trim();
const out = [intro];
for (const [name, blocks] of groups) out.push(`### ${name}\n${blocks.join("\n")}`);
console.log(out.filter(Boolean).join("\n\n"));
