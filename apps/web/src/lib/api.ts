/** A non-2xx answer; `detail` is the server's own message (`{ error: { code, message } }`). */
export class ApiError extends Error {
  readonly code?: string;
  readonly detail?: string;
  /** The error's own data, e.g. what uses a row (`in_use`). */
  readonly details?: unknown;
  /** The HTTP status, when the server answered. */
  readonly status?: number;
  constructor(message: string, code?: string, detail?: string, details?: unknown, status?: number) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.details = details;
    this.status = status;
  }
}

/**
 * Retries a failed read as React Query does (3 times), but not a 403 or 404: a missing or hidden
 * item stays so, and its page says it at once instead of after the retries (6.2.0 Step 3f).
 */
export const retryUnlessRefused = (count: number, error: unknown) =>
  count < 3 && !(error instanceof ApiError && (error.status === 403 || error.status === 404));

/**
 * Fired on a 403 to a write (a blocked GET is a hidden section, not an action), so the shell can say
 * the role isn't enough (the server enforces; ADR-0012). Its `detail` is the message's i18n key.
 */
export const FORBIDDEN_EVENT = "app:forbidden";

/** The shell's role banner with `key`: a 403, or a form the route guard sent the person away from. */
export const notifyDenied = (key = "common:forbidden") =>
  window.dispatchEvent(new CustomEvent<string>(FORBIDDEN_EVENT, { detail: key }));

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
    if (res.status === 403 && method !== "GET") notifyDenied();
    const e = (await res.json().catch(() => null))?.error;
    throw new ApiError(
      `${method} ${url} failed: ${res.status}`,
      e?.code,
      e?.message,
      e?.details,
      res.status,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
