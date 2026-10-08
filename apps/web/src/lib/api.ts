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
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
