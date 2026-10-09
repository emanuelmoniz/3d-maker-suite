import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
const WILDCARD = ["0.0.0.0", "::", "[::]"];

export const isLoopback = (host: string) => LOOPBACK.includes(host) || host === "::1";

const hostname = (header: string | undefined) => {
  try {
    return new URL(`http://${header}`).hostname;
  } catch {
    return null;
  }
};
const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Who may call the app. With a password: HTTP Basic auth (any user name), checked in constant time.
 * Without one: only requests addressed to loopback or the exact bind address, so a web page can't
 * reach the API through DNS rebinding.
 */
export function accessGuard({ host, password }: { host: string; password?: string }) {
  const allowed = new Set(LOOPBACK);
  if (!WILDCARD.includes(host)) allowed.add(host.includes(":") ? `[${host}]` : host);
  const expected = password ? digest(password) : null;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (expected) {
      const [scheme, value = ""] = (req.headers.authorization ?? "").split(" ");
      const pass = Buffer.from(value, "base64").toString().split(":").slice(1).join(":");
      if (scheme === "Basic" && timingSafeEqual(digest(pass), expected)) return;
      return reply
        .status(401)
        .header("www-authenticate", 'Basic realm="3D Maker Suite", charset="UTF-8"')
        .send({ error: { code: "unauthorized", message: "Password required" } });
    }
    const name = hostname(req.headers.host);
    if (!name || !allowed.has(name))
      return reply
        .status(403)
        .send({ error: { code: "forbidden_host", message: "Host not allowed" } });
  };
}
