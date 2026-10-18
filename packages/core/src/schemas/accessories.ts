import { z } from "zod";
import { accessoryInstallSchema, accessorySchema } from "./entities.ts";
import type { ColumnFilter } from "./list.ts";

/**
 * Fields the user edits. `PATCH` takes any subset, plus `archived` to archive/restore.
 * `number` defaults to the next free one.
 */
export const accessoryInputSchema = accessorySchema
  .pick({
    number: true,
    name: true,
    type: true,
    serial: true,
    purchasedAt: true,
    purchasePrice: true,
    warrantyEndsAt: true,
    warrantyNotes: true,
    state: true,
  })
  .partial({
    number: true,
    serial: true,
    purchasedAt: true,
    purchasePrice: true,
    warrantyEndsAt: true,
    warrantyNotes: true,
    state: true,
  });
export const accessoryPatchSchema = accessoryInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/** Put an accessory on a printer. */
export const installInputSchema = accessoryInstallSchema.pick({
  printerId: true,
  installedAt: true,
});
/** Take it off (or correct the removal date). */
export const installPatchSchema = z.object({ removedAt: accessoryInstallSchema.shape.installedAt });

export const accessorySortFields = ["name", "type", "state", "printer", "createdAt"] as const;

/** Accessories table column filters (see `listQuery`). */
export const accessoryFilters = {
  name: { kind: "text" },
  type: { kind: "text" },
  state: { kind: "select" },
  printerId: { kind: "select" },
} as const satisfies Record<string, ColumnFilter>;

export type AccessoryInput = z.infer<typeof accessoryInputSchema>;
export type AccessoryPatch = z.infer<typeof accessoryPatchSchema>;
export type InstallInput = z.infer<typeof installInputSchema>;
export type InstallPatch = z.infer<typeof installPatchSchema>;
