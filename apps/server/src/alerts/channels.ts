import type {
  Delivery,
  DeliveryInput,
  Notification,
  NotificationChannel,
} from "@3d-maker-suite/core";
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

// The global `topic` and `to` are the no-users mode's destination; with users each sets their own
// (ADR-0016), so the server settings stand without them.
const ntfy: NotificationChannel = {
  id: "ntfy",
  configSchema: z.object({ server: z.url(), topic: z.string().optional() }),
  secretsSchema: z.object({ token: z.string().optional() }),
  async send({ config, secrets }, n) {
    const { server, topic } = ntfy.configSchema.parse(config) as { server: string; topic?: string };
    if (!topic) throw new Error("ntfy has no topic");
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
    to: z.string().optional(),
  }),
  secretsSchema: z.object({ password: z.string().optional() }),
  async send({ config, secrets }, n) {
    const c = email.configSchema.parse(config) as Record<string, string | undefined>;
    if (!c.to) throw new Error("email has no recipient");
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

/** A user's own end of a channel: what replaces the global destination (and, if set, secrets). */
export type Destination = { channel: string; config: Record<string, string>; secrets?: Secrets };

/**
 * Throws if the channel is unknown or its saved settings are invalid. `to`: a user's destination,
 * else the global one (the no-users mode).
 */
export async function sendVia(
  db: Db,
  key: Buffer,
  id: string,
  n: Notification,
  to?: Omit<Destination, "channel">,
) {
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new Error(`Unknown channel ${id}`);
  const { config, secrets } = readChannel(db, key, id);
  await channel.send({ config: { ...config, ...to?.config }, secrets: to?.secrets ?? secrets }, n);
}

// --- Per-user delivery (ADR-0016): the servers are the channels' above, the ends are the user's.
type UserRow = typeof schema.users.$inferSelect;

/** Where a user's notify alerts go. A user's ntfy goes with their own token or none, never the global one. */
export function destinationsOf(key: Buffer, user: Pick<UserRow, "email" | "delivery">) {
  const d = user.delivery;
  const out: Destination[] = [];
  if (d.email) out.push({ channel: "email", config: { to: d.emailTo || user.email } });
  if (d.ntfyTopic)
    out.push({
      channel: "ntfy",
      config: { topic: d.ntfyTopic },
      secrets: d.ntfyToken ? decrypt(key, d.ntfyToken) : {},
    });
  return out;
}

export const deliveryView = (d: UserRow["delivery"]): Delivery => ({
  email: !!d.email,
  emailTo: d.emailTo || null,
  ntfyTopic: d.ntfyTopic || null,
  ntfyTokenSet: !!d.ntfyToken,
});

/** Left-out fields keep what is stored; an empty token keeps it too, null removes it. */
export function writeDelivery(db: Db, key: Buffer, user: UserRow, input: DeliveryInput) {
  const { ntfyToken, ...rest } = input;
  const next = { ...user.delivery, ...rest };
  if (ntfyToken === null) delete next.ntfyToken;
  else if (ntfyToken) next.ntfyToken = encrypt(key, { token: ntfyToken });
  // Empty = unset: the account email, no topic.
  if (!next.emailTo) delete next.emailTo;
  if (!next.ntfyTopic) delete next.ntfyTopic;
  db.update(schema.users).set({ delivery: next }).where(eq(schema.users.id, user.id)).run();
  return deliveryView(next);
}

/** The test button: each of the user's destinations on an enabled channel, and whether it went through. */
export async function testDelivery(
  db: Db,
  key: Buffer,
  user: UserRow,
  log: { warn: (o: object, m: string) => void },
) {
  const results = [];
  for (const d of destinationsOf(key, user)) {
    if (!readChannel(db, key, d.channel).enabled) continue;
    try {
      await sendVia(db, key, d.channel, { title: "3D Maker Suite", body: "Test notification" }, d);
      results.push({ channel: d.channel, ok: true });
    } catch (e) {
      log.warn({ err: e, channel: d.channel }, "test notification failed");
      results.push({ channel: d.channel, ok: false });
    }
  }
  return results;
}
