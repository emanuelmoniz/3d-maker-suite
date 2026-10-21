import { z } from "zod";
import { alertSchema, id, isoDate } from "./entities.ts";
import { ALERT_KINDS, ALERT_MODULES, ALERT_SEVERITIES } from "./enums.ts";
import { syncLogEntrySchema } from "./integrations.ts";
import { type ColumnFilter, listQuery } from "./list.ts";

/** An alert's expanded view: the log of the run it is about (a copy, runs get pruned). */
export const alertDetailSchema = z.object({
  runId: id.optional(),
  log: z.array(syncLogEntrySchema),
});

export const alertWithDetailSchema = alertSchema.extend({ detail: alertDetailSchema.nullable() });

export const alertActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }),
  /** Back to unread: the badge counts it again, and a read success returns to "needs attention". */
  z.object({ action: z.literal("unread") }),
  /** Take a dismissed alert back: it needs attention again while the condition holds. */
  z.object({ action: z.literal("undismiss") }),
  /** End a snooze early. */
  z.object({ action: z.literal("unsnooze") }),
  /** Hide until the condition resolves and comes back. */
  z.object({ action: z.literal("dismiss") }),
  /** Hide for `days`; if the condition still holds afterwards it alerts again. */
  z.object({ action: z.literal("snooze"), days: z.number().int().min(1).max(90) }),
]);

/** Where an alert that no longer needs attention stands. */
export const ALERT_STATUSES = ["snoozed", "read", "dismissed", "resolved"] as const;

/** A history row: the status is worked out by the server, `updatedAt` falls back to `createdAt`. */
export const alertHistoryItemSchema = alertSchema.extend({
  status: z.enum(ALERT_STATUSES),
  updatedAt: isoDate,
});

export const alertHistorySortFields = [
  "updatedAt",
  "createdAt",
  "module",
  "severity",
  "status",
] as const;
export const alertHistoryFilters = {
  kind: { kind: "select", options: ALERT_KINDS },
  module: { kind: "select", options: ALERT_MODULES },
  severity: { kind: "select", options: ALERT_SEVERITIES },
  status: { kind: "select", options: ALERT_STATUSES },
  createdAt: { kind: "date" },
  updatedAt: { kind: "date" },
} as const satisfies Record<string, ColumnFilter>;
export const alertHistoryQuery = listQuery(alertHistorySortFields, {}, alertHistoryFilters);

export const channelSettingsSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.string()),
  /** Names of secret fields that have a value. The values are never returned. */
  secretsSet: z.array(z.string()),
});

export const channelInputSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.string()),
  /** Omitted or empty keeps the stored value. */
  secrets: z.record(z.string(), z.string()).default({}),
});

export type AlertDetail = z.infer<typeof alertDetailSchema>;
export type AlertWithDetail = z.infer<typeof alertWithDetailSchema>;
export type AlertHistoryItem = z.infer<typeof alertHistoryItemSchema>;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export type AlertAction = z.infer<typeof alertActionSchema>;
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
export type ChannelInput = z.infer<typeof channelInputSchema>;
