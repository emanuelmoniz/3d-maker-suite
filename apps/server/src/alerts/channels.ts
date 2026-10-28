import type { Notification, NotificationChannel } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { decrypt, encrypt, type Secrets } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { z } from "zod";

// ntfy refuses messages over 4096 bytes; the short form keeps a few detail lines.
const NTFY_LINES = 5;
const NTFY_BYTES = 4000;

export function ntfyBody(n: Notification) {
  const more = (n.detail?.length ?? 0) - NTFY_LINES;
  const text = [
    n.body,
    ...(n.detail?.slice(0, NTFY_LINES) ?? []),
    ...(more > 0 ? [`…+${more}`] : []),
  ];
  // Cut by bytes, not characters; a split multi-byte character at the end is dropped.
  return Buffer.from(text.join("\n")).subarray(0, NTFY_BYTES).toString().replace(/�$/, "");
}

const ntfy: NotificationChannel = {
  id: "ntfy",
  configSchema: z.object({ server: z.url(), topic: z.string().min(1) }),
  secretsSchema: z.object({ token: z.string().optional() }),
  async send({ config, secrets }, n) {
    const { server, topic } = ntfy.configSchema.parse(config) as { server: string; topic: string };
    const res = await fetch(`${server.replace(/\/$/, "")}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        // HTTP headers are Latin-1, so non-ASCII titles go through RFC 2047 as ntfy documents.
        title: /^[\x20-\x7e]*$/.test(n.title)
          ? n.title
          : `=?UTF-8?B?${Buffer.from(n.title).toString("base64")}?=`,
        ...(secrets.token ? { authorization: `Bearer ${secrets.token}` } : {}),
        ...(n.url ? { click: n.url } : {}),
      },
      body: ntfyBody(n),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
  },
};

const email: NotificationChannel = {
  id: "email",
  configSchema: z.object({
    host: z.string().min(1),
    port: z.string().regex(/^\d+$/),
    user: z.string().optional(),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  secretsSchema: z.object({ password: z.string().optional() }),
  async send({ config, secrets }, n) {
    const c = email.configSchema.parse(config) as Record<string, string | undefined>;
    const transport = nodemailer.createTransport({
      host: c.host,
      port: Number(c.port),
      secure: c.port === "465",
      auth: c.user ? { user: c.user, pass: secrets.password } : undefined,
      connectionTimeout: 10_000,
    });
    await transport.sendMail({
      from: c.from,
      to: c.to,
      subject: n.title,
      text: [n.body, n.detail?.join("\n"), n.url].filter(Boolean).join("\n\n"),
    });
  },
};

export const channels: NotificationChannel[] = [ntfy, email];

// One `settings` row per channel; the secret fields are an encrypted blob inside it (ADR-0005).
type Stored = {
  enabled: boolean;
  config: Record<string, string>;
  secrets: ReturnType<typeof encrypt> | null;
};
const rowKey = (id: string) => `channel:${id}`;

export function readChannel(db: Db, key: Buffer, id: string) {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, rowKey(id)))
    .get();
  const v = row?.value as Stored | undefined;
  return {
    enabled: v?.enabled ?? false,
    config: v?.config ?? {},
    secrets: (v?.secrets ? decrypt(key, v.secrets) : {}) as Secrets,
  };
}

export function writeChannel(
  db: Db,
  key: Buffer,
  id: string,
  input: { enabled: boolean; config: Record<string, string>; secrets: Secrets },
) {
  // Empty values keep what is stored, so the UI never has to read a secret back.
  const secrets = {
    ...readChannel(db, key, id).secrets,
    ...Object.fromEntries(Object.entries(input.secrets).filter(([, v]) => v)),
  };
  const value: Stored = {
    enabled: input.enabled,
    config: input.config,
    secrets: Object.keys(secrets).length ? encrypt(key, secrets) : null,
  };
  db.insert(schema.settings)
    .values({ key: rowKey(id), value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
}

/** Throws if the channel is unknown or its saved settings are invalid. */
export async function sendVia(db: Db, key: Buffer, id: string, n: Notification) {
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new Error(`Unknown channel ${id}`);
  const { config, secrets } = readChannel(db, key, id);
  await channel.send({ config, secrets }, n);
}
