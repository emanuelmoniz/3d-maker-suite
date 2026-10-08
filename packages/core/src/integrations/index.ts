import type { z } from "zod";
import type { IntegrationErrorCode } from "../schemas/enums.ts";
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
}

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

/** Throw this from an adapter; any other error is reported as "unknown". */
export class IntegrationError extends Error {
  constructor(readonly code: IntegrationErrorCode) {
    super(code);
  }
}
