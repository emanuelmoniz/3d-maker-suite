import { z } from "zod";

export const portSchema = z.number().int().min(1).max(65535);

/** Saved in the data dir's config file; null removes the value. Applied on restart. */
export const serverConfigPatchSchema = z
  .object({ host: z.string().trim().min(1).nullable(), port: portSchema.nullable() })
  .partial()
  .strict();

const sourceSchema = z.enum(["cli", "env", "file", "default"]);

export const serverConfigResponseSchema = z.object({
  /** What the running server uses, and where that came from. */
  effective: z.object({
    host: z.string(),
    port: z.number(),
    hostSource: sourceSchema,
    portSource: sourceSchema,
  }),
  /** What is saved in the config file (used after a restart unless a flag or env var overrides it). */
  saved: z.object({ host: z.string().optional(), port: z.number().optional() }),
  passwordSet: z.boolean(),
});

/** Whether the app starts when the user signs in (only offered when the launch command is known). */
export const autostartSchema = z.object({ enabled: z.boolean() });
/** `supported` is false when the launch command is unknown (Docker, dev); then `enabled` is always false. */
export const autostartStateSchema = autostartSchema.extend({ supported: z.boolean() });

export type ServerConfigPatch = z.infer<typeof serverConfigPatchSchema>;
export type ServerConfigResponse = z.infer<typeof serverConfigResponseSchema>;
export type AutostartState = z.infer<typeof autostartStateSchema>;
