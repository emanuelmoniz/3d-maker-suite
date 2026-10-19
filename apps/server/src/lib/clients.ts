import { CLIENT_UNIQUE_FIELDS } from "@3d-maker-suite/core";
import { HttpError } from "../errors.ts";

/** Runs a write; a clash with a unique index becomes a 409 `client_<field>_taken`. */
export function unique<T>(write: () => T): T {
  try {
    return write();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const field = CLIENT_UNIQUE_FIELDS.find((f) => msg.startsWith("UNIQUE") && msg.includes(f));
    if (!field) throw e;
    throw new HttpError(409, `client_${field}_taken`, `Another client has this ${field}`);
  }
}
