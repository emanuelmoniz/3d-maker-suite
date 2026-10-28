import type { SecretStore } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { decrypt, encrypt, type Secrets } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";

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
