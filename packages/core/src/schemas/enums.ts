// Shared by zod schemas and DB check constraints (packages/db), so both stay in sync.
export const ORIGINS = ["manual", "integration"] as const;
export const PRINT_OUTCOMES = ["success", "failed", "cancelled"] as const;
export const ENERGY_SOURCES = ["estimated", "measured"] as const;
export const ALERT_KINDS = ["maintenance_due", "spool_low", "sync_failed", "print_failed"] as const;
export const COMMENT_STATUSES = ["open", "resolved"] as const;
export const SPOOL_STATUSES = ["new", "in_use", "empty"] as const;
// Why a spool's remaining weight changed. "print" entries are written by prints (Step 9+).
export const WEIGHT_ENTRY_KINDS = ["manual", "print", "correction"] as const;
export const TAGGABLE_TYPES = ["project", "print", "spool", "printer"] as const;
// Adapter errors are mapped to these; vendor messages never reach the API (ADR-0003).
export const INTEGRATION_ERROR_CODES = [
  "auth_required",
  "auth_expired",
  "rate_limited",
  "unreachable",
  "unknown",
] as const;
// "syncing" is reported while a run is in progress, never stored.
export const INTEGRATION_STATUSES = ["new", "syncing", "ok", "error"] as const;
export const SYNC_TRIGGERS = ["manual", "scheduled"] as const;
export const SYNC_RUN_STATUSES = ["ok", "error"] as const;

export type Origin = (typeof ORIGINS)[number];
export type PrintOutcome = (typeof PRINT_OUTCOMES)[number];
export type EnergySource = (typeof ENERGY_SOURCES)[number];
export type AlertKind = (typeof ALERT_KINDS)[number];
export type TaggableType = (typeof TAGGABLE_TYPES)[number];
export type SpoolStatus = (typeof SPOOL_STATUSES)[number];
export type WeightEntryKind = (typeof WEIGHT_ENTRY_KINDS)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];
