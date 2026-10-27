import type { Root, RootInput } from "@3d-maker-suite/core";
import type { FastifyInstance } from "fastify";

/**
 * Makes the project roots exactly these (a path, or a path with its settings), in order, through
 * the API: others are removed, existing ones get the settings. Returns them.
 */
export async function setRoots(app: FastifyInstance, ...wanted: (string | RootInput)[]) {
  const inputs = wanted.map((w) => (typeof w === "string" ? { path: w } : w));
  const call = async (method: "POST" | "PATCH" | "DELETE", url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload });
    if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.body}`);
    return res;
  };
  const have: Root[] = (await app.inject("/api/roots")).json();
  for (const r of have)
    if (!inputs.some((i) => i.path === r.path)) await call("DELETE", `/api/roots/${r.id}`);
  const out: Root[] = [];
  for (const { path, ...settings } of inputs) {
    const old = have.find((r) => r.path === path);
    const res = old
      ? await call("PATCH", `/api/roots/${old.id}`, settings)
      : await call("POST", "/api/roots", { path, ...settings });
    out.push(res.json());
  }
  return out;
}
