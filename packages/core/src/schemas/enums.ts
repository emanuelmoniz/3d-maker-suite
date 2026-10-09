// Shared by zod schemas and DB check constraints (packages/db), so both stay in sync.
export const ORIGINS = ["manual", "integration"] as const;
export const PRINT_OUTCOMES = ["success", "failed", "cancelled"] as const;
export const ENERGY_SOURCES = ["estimated", "measured"] as const;
export const ALERT_KINDS = [
  "maintenance_due",
  "spool_low",
  "sync_failed",
  "print_failed",
  "warranty_ending",
] as const;
export const COMMENT_STATUSES = ["open", "resolved"] as const;
export const SPOOL_STATUSES = ["new", "in_use", "empty"] as const;
// Why a spool's remaining weight changed. "print" entries are written by prints (Step 9+).
export const WEIGHT_ENTRY_KINDS = ["manual", "print", "correction"] as const;
// Project fields the user can edit. A re-scan only rewrites the ones NOT listed in `editedFields`.
export const PROJECT_EDITABLE_FIELDS = ["name", "description", "sourceUrl"] as const;
export const PROJECT_FILE_KINDS = ["model", "image", "doc", "shortcut"] as const;
export const TAGGABLE_TYPES = ["project", "print", "spool", "printer"] as const;
// Adapter errors are mapped to these; vendor messages never reach the API (ADR-0003).
export const INTEGRATION_ERROR_CODES = [
  "auth_required",
  "auth_expired",
  "rate_limited",
  "unreachable",
  "login_failed", // wrong email or password
  "code_invalid", // wrong or expired verification code
  "blocked", // anti-bot protection (e.g. a Cloudflare challenge) rejected the request
  "api_changed", // the vendor's response no longer matches what the adapter expects
  "unknown",
] as const;
// What an interactive sign-in asks for after the password.
export const LOGIN_CHALLENGES = ["email_code", "totp"] as const;
// "syncing" is reported while a run is in progress, never stored.
export const INTEGRATION_STATUSES = ["new", "syncing", "ok", "error"] as const;
export const SYNC_TRIGGERS = ["manual", "scheduled"] as const;
export const SYNC_RUN_STATUSES = ["ok", "error"] as const;
/** What an integration can do. The adapter declares them, the user switches each one off or on. */
export const CAPABILITIES = [
  "printers",
  "prints",
  "spools",
  "filamentProfiles",
  "openInSlicer",
] as const;
/** What a capability needs before it's usable: a signed-in account, a slicer folder or program. */
export const CAPABILITY_NEEDS = {
  printers: "account",
  prints: "account",
  spools: "account",
  filamentProfiles: "slicerConfig",
  openInSlicer: "slicerApp",
} as const satisfies Record<(typeof CAPABILITIES)[number], string>;

export type Origin = (typeof ORIGINS)[number];
export type PrintOutcome = (typeof PRINT_OUTCOMES)[number];
export type EnergySource = (typeof ENERGY_SOURCES)[number];
export type AlertKind = (typeof ALERT_KINDS)[number];
export type TaggableType = (typeof TAGGABLE_TYPES)[number];
export type SpoolStatus = (typeof SPOOL_STATUSES)[number];
export type WeightEntryKind = (typeof WEIGHT_ENTRY_KINDS)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];
export type LoginChallenge = (typeof LOGIN_CHALLENGES)[number];
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];
export type Capability = (typeof CAPABILITIES)[number];
