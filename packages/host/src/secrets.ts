import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ADR-0005: AES-256-GCM with a 32-byte key in `secret.key`, a fresh 12-byte IV per encryption.

export type Blob = { v: 1; iv: string; tag: string; data: string };
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
