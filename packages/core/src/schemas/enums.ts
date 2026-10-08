// Shared by zod schemas and DB check constraints (packages/db), so both stay in sync.
export const ORIGINS = ["manual", "integration"] as const;
export const PRINT_OUTCOMES = ["success", "failed", "cancelled"] as const;
export const ENERGY_SOURCES = ["estimated", "measured"] as const;
export const ALERT_KINDS = ["maintenance_due", "spool_low", "sync_failed", "print_failed"] as const;
export const COMMENT_STATUSES = ["open", "resolved"] as const;
export const TAGGABLE_TYPES = ["project", "print", "spool"] as const;

export type Origin = (typeof ORIGINS)[number];
export type PrintOutcome = (typeof PRINT_OUTCOMES)[number];
export type EnergySource = (typeof ENERGY_SOURCES)[number];
export type AlertKind = (typeof ALERT_KINDS)[number];
export type TaggableType = (typeof TAGGABLE_TYPES)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
