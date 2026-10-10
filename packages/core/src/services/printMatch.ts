const MIN_NAME = 3;

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\.gcode)?\.3mf$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Which of `items` an imported print's title names. A slicer titles a print after its project
 * file, often with a plate suffix (`honda_civic_plate_4` for `honda_civic.3mf`), so a name matches
 * when the title is that name or starts with it at a word boundary; case and punctuation are
 * ignored. Returns every item that has the longest matching name: several means a tie, and it is
 * the caller's to decide. `nameOf` gives a file name without its folder.
 */
export function bestMatches<T>(title: string, items: T[], nameOf: (item: T) => string): T[] {
  const t = key(title);
  const hits = items
    .map((item) => ({ item, name: key(nameOf(item)) }))
    .filter(({ name }) => name.length >= MIN_NAME && (t === name || t.startsWith(`${name} `)));
  const longest = hits.reduce((n, h) => Math.max(n, h.name.length), 0);
  return hits.filter((h) => h.name.length === longest).map((h) => h.item);
}
