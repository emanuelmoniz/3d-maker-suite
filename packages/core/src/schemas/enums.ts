// Shared by zod schemas and DB check constraints (packages/db), so both stay in sync.
export const ORIGINS = ["manual", "integration"] as const;
export const PRINT_OUTCOMES = ["success", "failed", "cancelled"] as const;
export const ENERGY_SOURCES = ["estimated", "measured"] as const;
// The kind is the message; severity, module and task say how bad and what raised it (ADR-0008).
export const ALERT_KINDS = [
  "maintenance_due",
  "spool_low",
  "spool_no_price",
  "spool_no_open_date",
  "warranty_ending",
  "sync_pending",
  "sync_success",
  "sync_error",
  "slice_setup_changed",
  "slice_failed",
  "update_available",
  "slicer_update",
  "connector_outdated",
] as const;
export const ALERT_SEVERITIES = ["error", "warning", "success"] as const;
export const ALERT_MODULES = [
  "filament",
  "maintenance",
  "printers",
  "integrations",
  "projects",
  "system",
  "hub",
] as const;
export const UPDATE_CHANNELS = ["stable", "dev"] as const;
// Fixed roles (ADR-0012).
export const USER_ROLES = ["admin", "editor", "viewer"] as const;
// Who edits a project root's files (ADR-0014): editors and admins, admins, picked users, nobody.
export const ROOT_EDIT_BY = ["roles", "admins", "users", "none"] as const;
export const COMMENT_STATUSES = ["open", "resolved"] as const;
export const SPOOL_STATUSES = ["new", "in_use", "empty"] as const;
// Why a spool's remaining weight changed. "print" entries are written by prints (Step 9+).
export const WEIGHT_ENTRY_KINDS = ["manual", "print", "correction"] as const;
// Project fields the user can edit. A re-scan only rewrites the ones NOT listed in `editedFields`.
export const PROJECT_EDITABLE_FIELDS = ["name", "description", "sourceUrl", "filePath"] as const;
export const PROJECT_FILE_KINDS = ["model", "image", "doc", "shortcut"] as const;
export const TAGGABLE_TYPES = ["project", "print", "spool", "printer", "accessory"] as const;
export const MAINTENANCE_TARGETS = ["printer", "accessory"] as const;
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
  "slice_failed", // the slicer refused or crashed; its own text is the detail
  "unknown",
] as const;
// What an interactive sign-in asks for after the password.
export const LOGIN_CHALLENGES = ["email_code", "totp"] as const;
// "syncing" (a run is in progress) and "unavailable" (a local source's folder isn't on this
// server) are reported, never stored.
export const INTEGRATION_STATUSES = ["new", "syncing", "ok", "error", "unavailable"] as const;
export const SYNC_TRIGGERS = ["manual", "scheduled"] as const;
export const SYNC_RUN_STATUSES = ["ok", "error"] as const;
// What one line of a run's log says (ADR-0008). `truncated` ends a log cut at its cap.
export const SYNC_LOG_EVENTS = [
  "created",
  "updated",
  "invalid",
  "left",
  "failed",
  "truncated",
] as const;
// Why a row was left for review: a pick nothing fits, a pick made from several, or just a look.
export const SYNC_LEFT_REASONS = ["pick", "unsure", "review"] as const;
/**
 * The data one run syncs or imports. Printers and prints sync on their own; the others need a
 * choice per row (e.g. the filament profile of a spool), so a run takes only the rows that need
 * none and the rest waits for the preview -> confirm flow.
 */
export const SYNC_TYPES = [
  "printers",
  "prints",
  "spools",
  "brands",
  "printerModels",
  "machineProfiles",
  "printProfiles",
  "filamentBrands",
  "filamentMaterials",
  "filamentProfiles",
] as const;
// Per integration and type: switched off, run by hand only, or run by the scheduler too.
export const SYNC_MODES = ["off", "manual", "auto"] as const;
// How often the scheduler runs an `auto` type ("1M" = 30 days). Ticks every 15 minutes.
export const SYNC_FREQUENCIES = ["15m", "1h", "1d", "1w", "1M"] as const;
/**
 * What a run takes: every row the source offers, or only rows you have plus new ones of a brand
 * you have (a new model of your printer brand).
 */
export const SYNC_SCOPES = ["all", "imported"] as const;
/**
 * What a run does with a source change to a row you have: write it, write it except the fields
 * you changed since the last import, or leave it for you to review (an alert).
 */
export const SYNC_MERGES = ["overwrite", "keepEdits", "review"] as const;
/**
 * A new spool from an integration: its value is taken from the source (weight) or the import day
 * (open date, spools in use only), left unset, or the spool waits for you to fill it in.
 */
export const NEW_SPOOL_FIELD = ["import", "unset", "review"] as const;
/**
 * Where an integration's data comes from: an account, or a folder and program on the server's
 * disk. It says nothing about which types it has; the adapter's capabilities do.
 */
/** `server`: a slicer the app downloads and runs itself (ADR-0013). */
export const INTEGRATION_KINDS = ["cloud", "local", "server"] as const;
/**
 * What an integration can do: the data types it provides, plus the `openInSlicer` and `slice`
 * actions. The adapter declares only what it really has, the user sets each one's sync policy
 * (or `off`).
 */
export const CAPABILITIES = [...SYNC_TYPES, "openInSlicer", "slice"] as const;
/** Actions are only on (`manual`) or `off`, and need the slicer program. */
export const ACTIONS = ["openInSlicer", "slice"] as const;
export const isAction = (c: string): c is (typeof ACTIONS)[number] =>
  (ACTIONS as readonly string[]).includes(c);

export type Origin = (typeof ORIGINS)[number];
export type PrintOutcome = (typeof PRINT_OUTCOMES)[number];
export type EnergySource = (typeof ENERGY_SOURCES)[number];
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export type AlertModule = (typeof ALERT_MODULES)[number];
export type TaggableType = (typeof TAGGABLE_TYPES)[number];
export type MaintenanceTarget = (typeof MAINTENANCE_TARGETS)[number];
export type SpoolStatus = (typeof SPOOL_STATUSES)[number];
export type WeightEntryKind = (typeof WEIGHT_ENTRY_KINDS)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];
export type LoginChallenge = (typeof LOGIN_CHALLENGES)[number];
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];
export type SyncType = (typeof SYNC_TYPES)[number];
export type SyncMode = (typeof SYNC_MODES)[number];
export type SyncFrequency = (typeof SYNC_FREQUENCIES)[number];
export type SyncScope = (typeof SYNC_SCOPES)[number];
export type SyncMerge = (typeof SYNC_MERGES)[number];
export type NewSpoolField = (typeof NEW_SPOOL_FIELD)[number];
export type Capability = (typeof CAPABILITIES)[number];
