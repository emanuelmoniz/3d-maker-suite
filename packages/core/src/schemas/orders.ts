import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import type { ColumnFilter } from "./list.ts";

export const orderSchema = z.object({
  id,
  /** Short unique number the order goes by ("007"). */
  number: z.number().int().positive(),
  clientId: id.nullable(),
  quoteId: id.nullable(),
  /** One or more. */
  projectIds: z.array(id),
  /** Minor units. */
  price: z.number().int().nonnegative(),
  /** One of `Preferences.orderStatuses`. */
  status: z.string().min(1),
  notes: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** An order with what its prints cost (today's prices, see `printCosts` on the server). */
export const orderDetailSchema = orderSchema.extend({
  printCount: z.number().int().nonnegative(),
  printsCost: z.number().int(),
});

/** `number` defaults to the next free one, `status` to the first of `orderStatuses`. */
export const orderInputSchema = z.object({
  number: orderSchema.shape.number.optional(),
  clientId: id.nullable().optional(),
  quoteId: id.nullable().optional(),
  projectIds: z
    .array(id)
    .min(1)
    .transform((ids) => [...new Set(ids)]),
  price: orderSchema.shape.price,
  status: orderSchema.shape.status.optional(),
  notes: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null),
});
export const orderPatchSchema = orderInputSchema.partial().strict();

export const orderSortFields = ["number", "client", "status", "price", "createdAt"] as const;

/** Orders table column filters (see `listQuery`). */
export const orderFilters = {
  number: { kind: "text" },
  clientId: { kind: "select" },
  /** Orders that include the project. */
  projectId: { kind: "select" },
  status: { kind: "select" },
  createdAt: { kind: "date" },
} as const satisfies Record<string, ColumnFilter>;

export type Order = z.infer<typeof orderSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type OrderInput = z.input<typeof orderInputSchema>;
export type OrderPatch = z.input<typeof orderPatchSchema>;
