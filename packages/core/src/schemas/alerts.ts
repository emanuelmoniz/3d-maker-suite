import { z } from "zod";
import { alertSchema, id } from "./entities.ts";
import { syncLogEntrySchema } from "./integrations.ts";

/** An alert's expanded view: the log of the run it is about (a copy, runs get pruned). */
export const alertDetailSchema = z.object({
  runId: id.optional(),
  log: z.array(syncLogEntrySchema),
});

export const alertWithDetailSchema = alertSchema.extend({ detail: alertDetailSchema.nullable() });

export const alertActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }),
  /** Hide until the condition resolves and comes back. */
  z.object({ action: z.literal("dismiss") }),
  /** Hide for `days`; if the condition still holds afterwards it alerts again. */
  z.object({ action: z.literal("snooze"), days: z.number().int().min(1).max(90) }),
]);

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
export type AlertAction = z.infer<typeof alertActionSchema>;
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
export type ChannelInput = z.infer<typeof channelInputSchema>;
