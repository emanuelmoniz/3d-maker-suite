/** The last folder of a path ("C:\x\001_vase" → "001_vase"); empty for a bare root. */
export const lastFolder = (path: string) =>
  path
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1) ?? "";

/** The folder `name` inside `root`, joined with the root's own separator. */
export const inRoot = (root: string, name: string) =>
  `${root.replace(/[\\/]+$/, "")}${root.includes("\\") ? "\\" : "/"}${name}`;
