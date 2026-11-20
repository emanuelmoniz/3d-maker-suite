import { z } from "zod";
import { id, tagSchema } from "./entities.ts";
import { TAGGABLE_TYPES } from "./enums.ts";

export const tagInputSchema = tagSchema.pick({ name: true, color: true });
export const tagPatchSchema = tagInputSchema.partial().strict();

/** `?entityType=print` lists every tagging of that type (the client joins them onto its list). */
export const taggingsQuery = z.object({ entityType: z.enum(TAGGABLE_TYPES) });
/** Replaces the whole tag set of one row. */
export const setTagsSchema = z.object({ tagIds: z.array(id).max(50) });
export const entityParams = z.object({ type: z.enum(TAGGABLE_TYPES), id });

export type TagInput = z.infer<typeof tagInputSchema>;
export type TagPatch = z.infer<typeof tagPatchSchema>;
