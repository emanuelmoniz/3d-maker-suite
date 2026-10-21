import type { z } from "zod";
import type {
  Capability,
  IntegrationErrorCode,
  IntegrationKind,
  LoginChallenge,
} from "../schemas/enums.ts";
import type { LibraryPreset, LibrarySpool } from "../schemas/filament.ts";
import type { ExternalPrint, ExternalPrinter, TestResult } from "../schemas/integrations.ts";
import type { SlicerCatalog } from "../schemas/slicerCatalog.ts";

// The contract a vendor package implements (ADR-0003, docs/architecture.md).
// Adapters return DTOs and never touch the database; the server validates and stores them.

export interface IntegrationAdapter {
  /** e.g. "bambu-cloud". The UI name is the i18n key `integrations:adapters.<id>.name`. */
  id: string;
  /** An account (`cloud`) or a folder and program on the server (`local`). */
  kind: IntegrationKind;
  /**
   * Only what this source really provides. A cloud one is usable once signed in, a local one once
   * its folder is found; `openInSlicer` only needs a program path.
   */
  capabilities: readonly Capability[];
  /** Non-secret settings, stored as plain JSON. */
  configSchema: z.ZodObject;
  /** Fields encrypted at rest (ADR-0005). String values only. */
  secretsSchema: z.ZodObject;
  /** Talks to the vendor's account. A source that only reads a local folder has none. */
  create?(ctx: IntegrationContext): IntegrationInstance;
  /** The vendor's desktop slicer presets. */
  library?: FilamentLibrary;
  /** Slices a 3MF plate with the vendor's slicer program (ADR-0007). Needs the `slice` capability. */
  slicer?: Slicer;
  /**
   * Interactive sign-in (password, then an email code or 2FA). Returns the secrets to store, or a
   * challenge; the server keeps `state` and passes it back with the code. Never store the password.
   */
  login?(ctx: Omit<IntegrationContext, "secrets">, input: LoginInput): Promise<LoginStep>;
}

export type LoginInput = { email: string; password: string } | { code: string; state: string };
export type LoginStep =
  | { secrets: Record<string, string> }
  | { challenge: LoginChallenge; state: string };

export interface IntegrationContext {
  /** Already validated with `configSchema`. */
  config: unknown;
  secrets: SecretStore;
  log: Logger;
  signal: AbortSignal;
}

/** Scoped to one integration row. */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  /** e.g. a refreshed token. */
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

type LogFn = (obj: object | string, msg?: string) => void;
/** The subset of pino an adapter may use. Secret paths are redacted by the server. */
export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

// Every capability is optional; an adapter implements what its vendor supports.
export interface IntegrationInstance {
  test(): Promise<TestResult>;
  printers?: PrinterInventorySource;
  printHistory?: PrintHistorySource;
  spools?: SpoolInventorySource;
}

export interface PrinterInventorySource {
  listPrinters(): Promise<ExternalPrinter[]>;
}

export interface PrintHistorySource {
  /**
   * Finished prints only, started at or after `since` and at or before `until`. Page with
   * `nextCursor`. The server drops anything outside the range, so `until` is a hint to stop early.
   */
  listPrints(q: {
    since?: string;
    until?: string;
    cursor?: string;
  }): Promise<{ items: ExternalPrint[]; nextCursor?: string }>;
}

/** Your spools as the vendor's account keeps them (e.g. Bambu's filament manager). */
export interface SpoolInventorySource {
  listSpools(): Promise<LibrarySpool[]>;
}

/** A slicer's local presets and catalog. Read-only, no account; the server never writes to it. */
export interface FilamentLibrary {
  /** e.g. "bambu-studio". The UI name is the i18n key `filament:library.sources.<id>`. */
  id: string;
  /** Config folders where this slicer usually lives on this OS; they may not exist. */
  defaultDirs(): string[];
  /** The config folder per OS as shown to the user (for "zip this folder" instructions). */
  folders?: { windows: string; mac: string; linux: string };
  /** `dir` exists. Unreadable or odd preset files are skipped, not fatal. */
  read(dir: string, opts: { includeSystem: boolean }): Promise<LibraryPreset[]>;
  /** Vendors' printer models (with thumbnails) and machine presets, system and user ones. */
  readCatalog?(dir: string): Promise<SlicerCatalog>;
}

/** One plate to slice. Preset ids are as the library names them (`system/<name>`, `user/<name>`). */
export interface SliceRequest {
  /** Absolute path, already checked to be inside a project root. */
  file: string;
  /** 1-based. */
  plate: number;
  /**
   * Machine preset of another printer than the 3MF's; unset = keep the 3MF's. Comes with a
   * `process`, since the file's own is made for its printer.
   */
  machine?: string;
  /** Process preset; unset = keep the 3MF's. */
  process?: string;
  /** Filament preset per slot (index 0 = slot 1); null = keep the 3MF's. */
  filaments?: (string | null)[];
}

export interface SliceResult {
  printTimeSeconds: number;
  weightGrams: number;
  filaments: { slot: number; grams: number; material: string | null }[];
}

/** Throws `IntegrationError("slice_failed", <the slicer's text>)` when the slicer refuses or crashes. */
export interface Slicer {
  slice(
    program: string,
    configDir: string,
    req: SliceRequest,
    signal: AbortSignal,
  ): Promise<SliceResult>;
}

/** Opens a local file in a slicer. The server decides which files are allowed before calling. */
export interface SlicerLauncher {
  canOpen(filePath: string): boolean;
  open(filePath: string): Promise<void>;
}

/** Throw this from an adapter; any other error is reported as "unknown". */
export class IntegrationError extends Error {
  /** `detail`: the vendor's own text, shown as-is where it helps (e.g. why a slice failed). */
  readonly code: IntegrationErrorCode;
  readonly detail?: string;
  constructor(code: IntegrationErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

/** What a channel delivers. Plain text; channels don't know about alert kinds. */
export interface Notification {
  title: string;
  body: string;
  /** The full detail, one line each (a sync log). A channel with little room shows the first few. */
  detail?: string[];
  /** Where to act on it in the app, absolute. */
  url?: string;
}

/** Where alerts go besides the in-app center (ntfy, email, ...). Settings are stored like an integration's. */
export interface NotificationChannel {
  /** e.g. "ntfy". The UI name is the i18n key `alerts:channels.<id>.name`. */
  id: string;
  /** Non-secret settings, plain JSON. */
  configSchema: z.ZodObject;
  /** Fields encrypted at rest (ADR-0005). String values only. */
  secretsSchema: z.ZodObject;
  /** Throws on failure. */
  send(
    settings: { config: unknown; secrets: Record<string, string> },
    n: Notification,
  ): Promise<void>;
}
