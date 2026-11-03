const segments = (p: string) => p.split(/[\\/]+/).filter(Boolean);

/** The leading folders every path shares (compared by whole folder, so "/a/b" ≠ "/a/bc"). */
export function commonStart(paths: string[]): string {
  const [first, ...others] = paths.map(segments);
  if (!first) return "";
  let n = first.length;
  for (const o of others) {
    let i = 0;
    while (i < n && i < o.length && o[i] === first[i]) i++;
    n = i;
  }
  const lead = paths[0]?.match(/^[\\/]{1,2}/)?.[0] ?? "";
  return lead + first.slice(0, n).join(paths[0]?.includes("\\") ? "\\" : "/");
}

/** `path` with the start `from` replaced by `to`, subfolders kept; null when `from` isn't its start. */
export function replaceStart(path: string, from: string, to: string): string | null {
  const a = segments(path);
  const f = segments(from);
  if (!f.length || f.length > a.length || f.some((s, i) => s !== a[i])) return null;
  const sep = to.includes("\\") ? "\\" : "/";
  return [to.replace(/[\\/]+$/, ""), ...a.slice(f.length)].join(sep);
}
