import { createHash, randomBytes } from "node:crypto";

// HTTP Digest (RFC 7616, MD5, qop=auth): how PrusaLink signs a person in (user `maker` and the
// password on the printer's screen). Node's fetch has no Digest, and no dependency is worth it for
// one printer family.

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

export interface Challenge {
  realm: string;
  nonce: string;
  opaque?: string;
  qop: boolean;
}

/** The `WWW-Authenticate: Digest ...` header as a challenge; undefined for any other scheme. */
export function parseChallenge(header: string | null): Challenge | undefined {
  if (!header || !/^digest\s/i.test(header)) return undefined;
  const p: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g))
    p[(m[1] ?? "").toLowerCase()] = m[2] ?? m[3] ?? "";
  if (!p.realm || !p.nonce) return undefined;
  return {
    realm: p.realm,
    nonce: p.nonce,
    opaque: p.opaque,
    qop: (p.qop ?? "").split(",").some((q) => q.trim() === "auth"),
  };
}

/** The `Authorization` header for one request. `nc` counts the requests made on this nonce. */
export function authorize(
  c: Challenge,
  user: string,
  password: string,
  method: string,
  uri: string,
  nc: number,
  cnonce = randomBytes(8).toString("hex"),
) {
  const ha1 = md5(`${user}:${c.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const count = nc.toString(16).padStart(8, "0");
  const response = c.qop
    ? md5(`${ha1}:${c.nonce}:${count}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${c.nonce}:${ha2}`);
  const parts = [
    `username="${user}"`,
    `realm="${c.realm}"`,
    `nonce="${c.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    ...(c.qop ? [`qop=auth`, `nc=${count}`, `cnonce="${cnonce}"`] : []),
    ...(c.opaque ? [`opaque="${c.opaque}"`] : []),
  ];
  return `Digest ${parts.join(", ")}`;
}
