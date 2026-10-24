/** A non-2xx answer; `detail` is the server's own message (`{ error: { code, message } }`). */
export class ApiError extends Error {
  readonly code?: string;
  readonly detail?: string;
  constructor(message: string, code?: string, detail?: string) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/** Fired on a 403, so the shell can say the role isn't enough (the server enforces; ADR-0012). */
export const FORBIDDEN_EVENT = "app:forbidden";

/** Sends the visitor to the login page, which returns to where they were. A reload on purpose: it drops every cached query. */
export function toLogin() {
  const { pathname, search } = window.location;
  if (pathname === "/login" || pathname === "/setup") return;
  window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`);
}

/** JSON fetch for the local API. Throws on non-2xx; 204 resolves to undefined. */
export async function api<T = void>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const raw = body instanceof Blob;
  const res = await fetch(url, {
    method,
    headers: body === undefined || raw ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    // A wrong password on the login form is a 401 too, but the form shows that itself.
    if (res.status === 401 && !url.startsWith("/api/auth/login")) toLogin();
    if (res.status === 403) window.dispatchEvent(new Event(FORBIDDEN_EVENT));
    const e = (await res.json().catch(() => null))?.error;
    throw new ApiError(`${method} ${url} failed: ${res.status}`, e?.code, e?.message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
