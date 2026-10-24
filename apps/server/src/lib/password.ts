import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt from node:crypto (ADR-0012). The cost goes into the stored string, so it can be raised
// later and old hashes still verify.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_BYTES = 64;

const derive = (password: string, salt: Buffer, len: number, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) =>
    // scrypt needs 128 * N * r bytes: 32 MiB at our cost, right on node's default maxmem.
    scrypt(password, salt, len, { N: n, r, p, maxmem: 256 * n * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

/** `scrypt$N$r$p$<salt b64>$<key b64>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_BYTES, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** False for a wrong password and for anything that isn't one of our hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key, ...rest] = stored.split("$");
  if (algo !== "scrypt" || !salt || !key || rest.length) return false;
  const expected = Buffer.from(key, "base64");
  if (!expected.length) return false;
  try {
    const actual = await derive(
      password,
      Buffer.from(salt, "base64"),
      expected.length,
      Number(n),
      Number(r),
      Number(p),
    );
    return timingSafeEqual(actual, expected);
  } catch {
    // Bad cost parameters in the string.
    return false;
  }
}
