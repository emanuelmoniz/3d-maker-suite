import { describe, expect, it } from "vitest";
import { galleryImages, projectMetaSchema } from "./projects.ts";

const meta = projectMetaSchema.parse({
  files: [
    { path: "cover.png", kind: "image", size: 1 },
    { path: "pics/a.png", kind: "image", size: 1 },
    { path: "pics/old/b.svg", kind: "image", size: 1 },
    { path: "picsx/c.jpg", kind: "image", size: 1 },
    { path: "pics/notes.txt", kind: "doc", size: 1 },
  ],
});
const paths = (folders: string[], images: string[]) =>
  galleryImages({ meta, gallery: { folders, images } }).map((f) => f.path);

describe("galleryImages", () => {
  it("shows chosen images and every image under a chosen folder, once, in folder order", () => {
    expect(paths(["pics"], ["pics/a.png", "cover.png", "gone.png"])).toEqual([
      "cover.png",
      "pics/a.png",
      "pics/old/b.svg",
    ]);
    expect(paths([""], [])).toHaveLength(4);
    expect(paths([], [])).toEqual([]);
  });
});
