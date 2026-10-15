/** A non-2xx answer; `detail` is the server's own message (`{ error: { code, message } }`). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly detail?: string,
  ) {
    super(message);
  }
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
    const e = (await res.json().catch(() => null))?.error;
    throw new ApiError(`${method} ${url} failed: ${res.status}`, e?.code, e?.message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
