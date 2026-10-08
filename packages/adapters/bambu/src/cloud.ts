import { IntegrationError, type Logger } from "@3d-maker-suite/core";
import type { z } from "zod";

// Bambu Cloud has no official API. Endpoints and headers follow the community docs
// (OpenBambuAPI cloud-http.md, ha-bambulab pybambu); see docs/adr/0006-bambu-cloud-first.md.
export const REGIONS = ["global", "china"] as const;
export type Region = (typeof REGIONS)[number];

export const URLS = {
  login: "https://api.bambulab.com/v1/user-service/user/login",
  emailCode: "https://api.bambulab.com/v1/user-service/user/sendemail/code",
  csrf: "https://bambulab.com/api/csrf",
  tfaLogin: "https://bambulab.com/api/sign-in/tfa",
  bind: "https://api.bambulab.com/v1/iot-service/api/user/bind",
  tasks: "https://api.bambulab.com/v1/user-service/my/tasks",
  spools: "https://api.bambulab.com/v1/design-user-service/my/filament/v2",
};

const HEADERS = {
  "user-agent": "bambu_network_agent/01.09.05.01",
  "x-bbl-client-name": "OrcaSlicer",
  "x-bbl-client-type": "slicer",
  "x-bbl-client-version": "01.09.05.51",
  "x-bbl-os-type": "linux",
};

type CallOpts = {
  region: Region;
  log: Logger;
  signal: AbortSignal;
  token?: string;
  /** Sent as JSON with POST; without it the request is a GET. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Error statuses the caller handles itself (e.g. a wrong password). */
  expect?: number[];
};

/** fetch + mapping of every transport/HTTP failure to an `IntegrationError`. */
export async function call(url: string, o: CallOpts): Promise<Response> {
  const target = o.region === "china" ? url.replace(".com/", ".cn/") : url;
  const path = new URL(target).pathname; // logged instead of the full request
  let res: Response;
  try {
    res = await fetch(target, {
      method: o.body === undefined ? "GET" : "POST",
      headers: {
        ...HEADERS,
        ...(o.body !== undefined && { "content-type": "application/json" }),
        ...(o.token && { authorization: `Bearer ${o.token}` }),
        ...o.headers,
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal,
    });
  } catch (err) {
    o.log.warn({ path, err: (err as Error).name }, "bambu request failed");
    throw new IntegrationError("unreachable");
  }
  if (res.ok) return res;
  o.log.warn({ path, status: res.status }, "bambu request rejected");
  const isJson = res.headers.get("content-type")?.includes("json");
  // Cloudflare answers clients it doesn't trust with an HTML challenge page.
  if (res.headers.has("cf-mitigated") || (!isJson && [403, 429, 503].includes(res.status)))
    throw new IntegrationError("blocked");
  if (o.expect?.includes(res.status)) return res;
  if (res.status === 429) throw new IntegrationError("rate_limited");
  if (res.status === 401 || res.status === 403) throw new IntegrationError("auth_expired");
  if (res.status >= 500) throw new IntegrationError("unreachable");
  throw new IntegrationError("unknown");
}

/** A body that doesn't match `schema` means the unofficial API changed under us. */
export async function parse<T>(res: Response, schema: z.ZodType<T>, log: Logger): Promise<T> {
  const r = schema.safeParse(await res.json().catch(() => undefined));
  if (r.success) return r.data;
  // Paths and codes only: values could be tokens.
  const issues = r.error.issues.map((i) => ({ path: i.path, code: i.code }));
  log.warn({ issues }, "unexpected bambu response");
  throw new IntegrationError("api_changed");
}

export const cookie = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
