import { z } from "zod";
import type { ColumnFilter } from "./list.ts";

/** Lowest first. `success` is a pino custom level between info and warn. */
export const LOG_LEVELS = ["debug", "info", "success", "warn", "error"] as const;
/** Where a line came from: the API path it served, or the background job that wrote it. */
export const LOG_MODULES = [
  "system",
  "printers",
  "accessories",
  "maintenance",
  "filament",
  "projects",
  "prints",
  "quotes",
  "orders",
  "clients",
  "stats",
  "alerts",
  "import",
  "integrations",
  "backups",
  "settings",
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogModule = (typeof LOG_MODULES)[number];

export const logEntrySchema = z.object({
  id: z.number().int(),
  time: z.string(),
  level: z.enum(LOG_LEVELS),
  module: z.string(),
  /** Who made the request: the user's name; null for jobs and the no-users mode. */
  actor: z.string().nullable(),
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const logSortFields = ["time", "level", "module", "actor", "message"] as const;

/** Logs table column filters (see `listQuery`). */
export const logFilters = {
  time: { kind: "date" },
  level: { kind: "select", options: LOG_LEVELS },
  module: { kind: "select", options: LOG_MODULES },
  actor: { kind: "text" },
  message: { kind: "text" },
} as const satisfies Record<string, ColumnFilter>;
