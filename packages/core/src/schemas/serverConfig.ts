import { z } from "zod";

export const portSchema = z.number().int().min(1).max(65535);

/** The address links in notifications point to: http(s) only, saved without a trailing slash. */
export const publicUrlSchema = z
  .string()
  .trim()
  .refine((v) => /^https?:\/\/[^/\s]/i.test(v) && URL.canParse(v))
  .transform((v) => v.replace(/\/+$/, ""));

/** Saved in the data dir's config file; null removes the value. Host and port apply on restart, the public address at once. */
export const serverConfigPatchSchema = z
  .object({
    host: z.string().trim().min(1).nullable(),
    port: portSchema.nullable(),
    publicUrl: publicUrlSchema.nullable(),
  })
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
    /** `env` = APP_PUBLIC_URL, fixed; `file` = saved; `default` = none. */
    publicUrl: z.string().optional(),
    publicUrlSource: z.enum(["env", "file", "default"]),
  }),
  /** What is saved in the config file (used after a restart unless a flag or env var overrides it). */
  saved: z.object({
    host: z.string().optional(),
    port: z.number().optional(),
    publicUrl: z.string().optional(),
  }),
  /** Used after a restart when nothing is saved and no flag or env var is set. */
  defaults: z.object({ host: z.string(), port: z.number() }),
  passwordSet: z.boolean(),
  /** The server's non-internal IPv4 addresses; empty in Docker, where they are container addresses. */
  detected: z.array(z.string()),
  docker: z.boolean(),
  /** Where notification links point now; none = no link. */
  link: z.string().optional(),
});

/** The address to try, before or after saving it. */
export const testAddressSchema = z.object({ url: publicUrlSchema });
/** `otherServer`: it answered but isn't this server (or redirected). `hostNotAllowed`: 403 forbidden_host. */
export const testAddressResultSchema = z.enum([
  "ok",
  "notFound",
  "refused",
  "certificate",
  "timeout",
  "otherServer",
  "hostNotAllowed",
]);
export const testAddressResponseSchema = z.object({ result: testAddressResultSchema });

/** Whether the app starts when the user signs in (only offered when the launch command is known). */
export const autostartSchema = z.object({ enabled: z.boolean() });
/** `supported` is false when the launch command is unknown (Docker, dev); then `enabled` is always false. */
export const autostartStateSchema = autostartSchema.extend({ supported: z.boolean() });

export type ServerConfigPatch = z.infer<typeof serverConfigPatchSchema>;
export type ServerConfigResponse = z.infer<typeof serverConfigResponseSchema>;
export type TestAddressResult = z.infer<typeof testAddressResultSchema>;
export type AutostartState = z.infer<typeof autostartStateSchema>;
