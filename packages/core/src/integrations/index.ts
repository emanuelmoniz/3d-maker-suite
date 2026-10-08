import type { z } from "zod";
import type { IntegrationErrorCode, LoginChallenge } from "../schemas/enums.ts";
import type { LibraryPreset, LibrarySpool } from "../schemas/filament.ts";
import type { ExternalPrint, ExternalPrinter, TestResult } from "../schemas/integrations.ts";

// The contract a vendor package implements (ADR-0003, docs/architecture.md).
// Adapters return DTOs and never touch the database; the server validates and stores them.

export interface IntegrationAdapter {
  /** e.g. "bambu-cloud". The UI name is the i18n key `integrations:adapters.<id>.name`. */
  id: string;
  /** Non-secret settings, stored as plain JSON. */
  configSchema: z.ZodObject;
  /** Fields encrypted at rest (ADR-0005). String values only. */
  secretsSchema: z.ZodObject;
  create(ctx: IntegrationContext): IntegrationInstance;
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
// filaments / projects / slicer / marketplace arrive with Steps 14, 16 and 18.
export interface IntegrationInstance {
  test(): Promise<TestResult>;
  printers?: PrinterInventorySource;
  printHistory?: PrintHistorySource;
}

export interface PrinterInventorySource {
  listPrinters(): Promise<ExternalPrinter[]>;
}

export interface PrintHistorySource {
  /** Finished prints only, started at or after `since`. Page with `nextCursor`. */
  listPrints(q: {
    since?: string;
    cursor?: string;
  }): Promise<{ items: ExternalPrint[]; nextCursor?: string }>;
}

/** A slicer's local filament presets. Read-only, no account; the server never writes to it. */
export interface FilamentLibrary {
  /** e.g. "bambu-studio". The UI name is the i18n key `filament:library.sources.<id>`. */
  id: string;
  /** Config folders where this slicer usually lives on this OS; they may not exist. */
  defaultDirs(): string[];
  /** `dir` exists. Unreadable or odd preset files are skipped, not fatal. */
  read(dir: string, opts: { includeSystem: boolean }): Promise<LibraryPreset[]>;
  /** Your spools from the slicer's filament inventory, if it keeps one. A missing inventory is `[]`. */
  readSpools?(dir: string): Promise<LibrarySpool[]>;
}

/** Opens a local file in a slicer. The server decides which files are allowed before calling. */
export interface SlicerLauncher {
  canOpen(filePath: string): boolean;
  open(filePath: string): Promise<void>;
}

/** Throw this from an adapter; any other error is reported as "unknown". */
export class IntegrationError extends Error {
  constructor(readonly code: IntegrationErrorCode) {
    super(code);
  }
}

/** What a channel delivers. Plain text; channels don't know about alert kinds. */
export interface Notification {
  title: string;
  body: string;
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
