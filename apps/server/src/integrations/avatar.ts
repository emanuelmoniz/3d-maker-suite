import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// An account's photo, fetched by the server and kept in the data folder (ADR-0021), so the browser
// never calls the vendor.
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
type AvatarType = keyof typeof TYPES;
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;

const fileOf = (dataDir: string, id: string, type: AvatarType) =>
  join(dataDir, "avatars", `${id}.${TYPES[type]}`);

function cached(dataDir: string, id: string) {
  for (const type of Object.keys(TYPES) as AvatarType[]) {
    const file = fileOf(dataDir, id, type);
    if (existsSync(file)) return { type, body: readFileSync(file) };
  }
}

export function dropAvatar(dataDir: string, id: string) {
  if (!dataDir) return;
  for (const type of Object.keys(TYPES) as AvatarType[])
    rmSync(fileOf(dataDir, id, type), { force: true });
}

/** The cached photo, else fetched from `url` (https only, an image of 1 MB at most). */
export async function avatar(dataDir: string, id: string, url: string | undefined) {
  const hit = dataDir ? cached(dataDir, id) : undefined;
  if (hit || !url?.startsWith("https://")) return hit;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  // Bambu's CDN answers `image/jpg`, not the registered `image/jpeg`.
  const type = res.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .replace("image/jpg", "image/jpeg") as AvatarType;
  if (!res.ok || !(type in TYPES) || Number(res.headers.get("content-length")) > MAX_BYTES) return;
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BYTES) return;
  if (dataDir) {
    mkdirSync(join(dataDir, "avatars"), { recursive: true });
    writeFileSync(fileOf(dataDir, id, type), body);
  }
  return { type, body };
}
