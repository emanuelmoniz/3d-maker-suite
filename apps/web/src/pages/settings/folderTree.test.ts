import { describe, expect, it } from "vitest";
import { folderTree, type TreeNode } from "./folderTree.ts";

/** The path of names down to the open project, and every node's name with its listed flag. */
const pathToProject = (n: TreeNode): string[] =>
  n.kind === "project" ? [n.name] : [n.name, ...pathToProject(n.children[0] as TreeNode)];
const listed = (n: TreeNode): Record<string, boolean> =>
  Object.assign({ [n.name]: n.listed }, ...n.children.map(listed));

describe("folderTree", () => {
  it("depth 1, all files: projects right below the folder, everything listed", () => {
    const tree = folderTree({ projectDepth: 1, filesDepth: null });
    expect(pathToProject(tree)).toEqual(["designs", "project"]);
    expect(tree.children.map((c) => c.kind)).toEqual(["project", "project"]);
    expect(Object.values(listed(tree)).every(Boolean)).toBe(true);
  });

  it("depth 3, files 0: two group levels, only the project's own files", () => {
    const tree = folderTree({ projectDepth: 3, filesDepth: 0, rootName: "models" });
    expect(tree.text).toBe("models");
    expect(pathToProject(tree)).toEqual(["designs", "furniture", "shelves", "project"]);
    expect(listed(tree)).toMatchObject({
      furniture: true,
      model: true,
      images: false,
      cover: false,
      draft: false,
    });
  });

  it("files 1: the first subfolder level is listed, the next isn't", () => {
    expect(listed(folderTree({ projectDepth: 2, filesDepth: 1 }))).toMatchObject({
      images: true,
      cover: true,
      old: false,
      draft: false,
      year: false,
      firstTry: false,
    });
  });

  it("depth 5 uses four group levels", () => {
    expect(pathToProject(folderTree({ projectDepth: 5, filesDepth: 3 }))).toHaveLength(6);
  });
});
