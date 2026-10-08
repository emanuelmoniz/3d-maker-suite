import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SecretStore } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";

// ADR-0005: AES-256-GCM with a 32-byte key in `secret.key`, a fresh 12-byte IV per encryption.

type Blob = { v: 1; iv: string; tag: string; data: string };
export type Secrets = Record<string, string>;

/** Reads `secret.key` from the data dir, creating it (user-only) on first run. */
export function loadKey(dataDir: string): Buffer {
  const file = join(dataDir, "secret.key");
  try {
    return readFileSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const key = randomBytes(32);
    writeFileSync(file, key, { mode: 0o600, flag: "wx" });
    return key;
  }
}

export function encrypt(key: Buffer, secrets: Secrets): Blob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  const b64 = (b: Buffer) => b.toString("base64");
  return { v: 1, iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) };
}

/** Throws if the blob was tampered with or the key is wrong. */
export function decrypt(key: Buffer, blob: Blob): Secrets {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const text = decipher.update(blob.data, "base64", "utf8") + decipher.final("utf8");
  return JSON.parse(text);
}

const { integrations } = schema;

export function readSecrets(db: Db, key: Buffer, id: string): Secrets {
  const row = db
    .select({ secrets: integrations.secrets })
    .from(integrations)
    .where(eq(integrations.id, id))
    .get();
  return row?.secrets ? decrypt(key, JSON.parse(row.secrets)) : {};
}

export function writeSecrets(db: Db, key: Buffer, id: string, secrets: Secrets) {
  const value = Object.keys(secrets).length ? JSON.stringify(encrypt(key, secrets)) : null;
  db.update(integrations).set({ secrets: value }).where(eq(integrations.id, id)).run();
}

/** What an adapter sees: get/set/delete on its own row only. */
export function secretStore(db: Db, key: Buffer, id: string): SecretStore {
  return {
    get: async (k) => readSecrets(db, key, id)[k],
    set: async (k, v) => writeSecrets(db, key, id, { ...readSecrets(db, key, id), [k]: v }),
    delete: async (k) => {
      const { [k]: _, ...rest } = readSecrets(db, key, id);
      writeSecrets(db, key, id, rest);
    },
  };
}
