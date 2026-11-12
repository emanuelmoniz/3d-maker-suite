/** The example names; the page translates each one (folder.example.names in settings.json). */
export type ExampleName =
  | "designs"
  | "furniture"
  | "shelves"
  | "wall"
  | "small"
  | "project"
  | "sibling"
  | "model"
  | "images"
  | "cover"
  | "old"
  | "draft"
  | "year"
  | "firstTry";

export type TreeNode = {
  /** An example name, or `text` for the real folder's own name. */
  name: ExampleName;
  text?: string;
  kind: "root" | "group" | "project" | "folder" | "file";
  /** Listed and watched in its project; false past the files levels. */
  listed: boolean;
  children: TreeNode[];
};

const GROUPS: ExampleName[] = ["furniture", "shelves", "wall", "small"];

const node = (
  name: ExampleName,
  kind: TreeNode["kind"],
  listed = true,
  children: TreeNode[] = [],
): TreeNode => ({ name, kind, listed, children });

/**
 * An example folder as a project folder with these settings reads it: `projectDepth - 1` group
 * folders, then a project (open) and a sibling, and the project's files 0 to 3 subfolder levels
 * down, each listed when `filesDepth` (null = all) reaches its level.
 */
export function folderTree({
  projectDepth,
  filesDepth,
  rootName,
}: {
  projectDepth: number;
  filesDepth: number | null;
  rootName?: string;
}): TreeNode {
  const at = (level: number) => filesDepth == null || level <= filesDepth;
  const files = [
    node("model", "file"),
    node("images", "folder", at(1), [
      node("cover", "file", at(1)),
      node("old", "folder", at(2), [
        node("draft", "file", at(2)),
        node("year", "folder", at(3), [node("firstTry", "file", at(3))]),
      ]),
    ]),
  ];
  let level = [node("project", "project", true, files), node("sibling", "project")];
  for (const name of GROUPS.slice(0, Math.max(0, projectDepth - 1)).reverse())
    level = [node(name, "group", true, level)];
  return { ...node("designs", "root", true, level), ...(rootName ? { text: rootName } : {}) };
}
