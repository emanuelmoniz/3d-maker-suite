import { z } from "zod";
import type { clientSchema } from "./entities.ts";
import type { ColumnFilter } from "./list.ts";

const required = z.string().trim().min(1);
/** Optional text: blank means not filled (null), which the unique indexes ignore. */
const optional = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null);

/** Fields the user edits. `PATCH` takes any subset. */
export const clientInputSchema = z.object({
  name: required,
  mobile: required,
  vat: optional,
  email: optional.pipe(z.email().nullable()),
  address: optional,
  notes: optional,
});
export const clientPatchSchema = clientInputSchema.partial().strict();

export const clientSortFields = ["name", "mobile", "vat", "email", "createdAt"] as const;

/** Clients table column filters (see `listQuery`). */
export const clientFilters = {
  name: { kind: "text" },
  mobile: { kind: "text" },
  vat: { kind: "text" },
  email: { kind: "text" },
} as const satisfies Record<string, ColumnFilter>;

/** The fields with a unique index; a clash is a 409 `client_<field>_taken`. */
export const CLIENT_UNIQUE_FIELDS = ["vat", "mobile", "email"] as const;

export type Client = z.infer<typeof clientSchema>;
export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientPatch = z.input<typeof clientPatchSchema>;
