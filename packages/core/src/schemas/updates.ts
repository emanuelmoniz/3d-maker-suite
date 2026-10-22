import { z } from "zod";

/** How the app was installed decides what Update does (ADR-0009). */
export const INSTALL_TYPES = ["git", "docker", "other", "dev"] as const;
/** The launcher step an update or rollback failed at. */
export const UPDATE_FAILED_STEPS = ["checkout", "node", "install", "build"] as const;

export const updateHistoryEntrySchema = z.object({
  action: z.enum(["update", "rollback"]),
  at: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  /** The commit that ran before; a rollback checks it out again. */
  fromSha: z.string(),
  /** update: taken before it; rollback: the one restored. */
  backup: z.string(),
  ok: z.boolean(),
  failedStep: z.enum(UPDATE_FAILED_STEPS).optional(),
  /** Node major the failed release needs (failedStep `node`). */
  needsNode: z.number().optional(),
});

export const updatesResponseSchema = z.object({
  version: z.string(),
  install: z.enum(INSTALL_TYPES),
  /** Newest release on the channel newer than the running one; null = up to date or not checked. */
  latest: z.object({ tag: z.string(), url: z.string() }).nullable(),
  checkedAt: z.string().nullable(),
  /** The last check could not reach GitHub. */
  checkFailed: z.boolean(),
  /** Newest first; `canRollBack` = its backup still exists and it goes to an older version. */
  history: z.array(updateHistoryEntrySchema.extend({ canRollBack: z.boolean() })),
});

export const updateApplySchema = z.object({ tag: z.string() }).strict();
export const updateRollbackSchema = z.object({ backup: z.string() }).strict();

export type InstallType = (typeof INSTALL_TYPES)[number];
export type UpdateHistoryEntry = z.infer<typeof updateHistoryEntrySchema>;
export type UpdatesResponse = z.infer<typeof updatesResponseSchema>;
