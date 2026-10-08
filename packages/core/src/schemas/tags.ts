import { z } from "zod";
import { collectionSchema, id, tagSchema } from "./entities.ts";
import { TAGGABLE_TYPES } from "./enums.ts";

export const tagInputSchema = tagSchema.pick({ name: true, color: true });
export const tagPatchSchema = tagInputSchema.partial().strict();

/** `?entityType=print` lists every tagging of that type (the client joins them onto its list). */
export const taggingsQuery = z.object({ entityType: z.enum(TAGGABLE_TYPES) });
/** Replaces the whole tag set of one row. */
export const setTagsSchema = z.object({ tagIds: z.array(id).max(50) });
export const entityParams = z.object({ type: z.enum(TAGGABLE_TYPES), id });

export const collectionInputSchema = collectionSchema
  .pick({ name: true })
  .extend({ description: z.string().nullable().optional() });
export const collectionPatchSchema = collectionInputSchema.partial().strict();
/** A collection with its projects in manual order. */
export const collectionDetailSchema = collectionSchema.and(z.object({ projectIds: z.array(id) }));
/** Sending `projectIds` replaces membership and order. */
export const setCollectionProjectsSchema = z.object({ projectIds: z.array(id).max(500) });

export type TagInput = z.infer<typeof tagInputSchema>;
export type TagPatch = z.infer<typeof tagPatchSchema>;
export type CollectionDetail = z.infer<typeof collectionDetailSchema>;
export type CollectionInput = z.infer<typeof collectionInputSchema>;
