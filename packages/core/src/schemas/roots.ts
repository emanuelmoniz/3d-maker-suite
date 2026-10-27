import { z } from "zod";
import { id, isoDate } from "./entities.ts";

/** Where a root's files live (ADR-0014): "hub" is a folder on this server. */
export const ROOT_HUB = "hub";

/** A folder searched for projects, with its own scan settings. */
export const rootSchema = z.object({
  id,
  name: z.string().min(1),
  location: z.string().min(1),
  /** Absolute on its location, as picked. */
  path: z.string().min(1),
  /** How many folder levels below the root a project may sit (1 = direct subfolders). */
  projectDepth: z.number().int().min(1).max(5),
  /** Subfolder levels below a project folder that are listed and watched; null = all. */
  filesDepth: z.number().int().min(0).nullable(),
  /** Off: its projects don't slice again when a file changes (unless a project says so). */
  autoSlice: z.boolean(),
  position: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Root = z.infer<typeof rootSchema>;

const settings = rootSchema.pick({ projectDepth: true, filesDepth: true, autoSlice: true });
export const ROOT_DEFAULTS: z.infer<typeof settings> = {
  projectDepth: 1,
  filesDepth: null,
  autoSlice: true,
};

/** A new root on the hub; the name defaults to the folder's own name, settings to `ROOT_DEFAULTS`. */
export const rootInputSchema = settings
  .partial()
  .extend({ path: rootSchema.shape.path, name: rootSchema.shape.name.optional() })
  .strict();
/** The path stays: a root at another path is another root (its projects point at this one). */
export const rootPatchSchema = settings.extend({ name: rootSchema.shape.name }).partial().strict();

export type RootInput = z.infer<typeof rootInputSchema>;
export type RootPatch = z.infer<typeof rootPatchSchema>;
