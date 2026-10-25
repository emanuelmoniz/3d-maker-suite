import { z } from "zod";

/** No path lists the roots (drives on Windows, `/` and home elsewhere). Absolute check is done server-side. */
export const fsListQuerySchema = z.object({
  path: z.string().min(1).optional(),
  mode: z.enum(["folder", "file"]).default("folder"),
  /** Comma-separated extensions, e.g. ".exe,.3mf"; only filters files in file mode. */
  ext: z.string().optional(),
});

/** Names and types only, never sizes, dates or contents. */
export const fsListResponseSchema = z.object({
  path: z.string().nullable(),
  parent: z.string().nullable(),
  sep: z.enum(["/", "\\"]),
  entries: z.array(z.object({ name: z.string(), path: z.string(), type: z.enum(["dir", "file"]) })),
});

/** A new folder `name` inside the existing folder `path`. One name, never a path. */
export const fsFolderInputSchema = z.object({
  path: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\\/:*?"<>|\p{Cc}]+$/u)
    .refine((n) => n !== "." && n !== ".." && !n.endsWith(".")),
});

export const fsFolderResponseSchema = z.object({ path: z.string() });

export type FsListQuery = z.input<typeof fsListQuerySchema>;
export type FsListResponse = z.infer<typeof fsListResponseSchema>;
