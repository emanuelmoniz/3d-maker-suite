// An in-memory Spoolman for tests: the endpoints the adapter uses, as Spoolman 0.27 behaves
// (fixtures/SOURCE.md). A PATCH replaces all `extra` fields; an extra key no field defines is
// refused; a text field's value must be a JSON string. `loseAnswers` applies a spool's write
// (`PATCH`/`POST /spool`), then fails the request as a timeout would: the retry must not charge
// twice.

type Json = Record<string, unknown>;
type Vendor = { id: number; name: string };
type Filament = Json & { id: number; vendor?: Vendor | null };
type Spool = {
  id: number;
  filament: Filament;
  initial_weight: number | null;
  spool_weight: number | null;
  used_weight: number;
  archived: boolean;
  extra: Record<string, string>;
};

export type FakeSpoolman = ReturnType<typeof fakeSpoolman>;

export function fakeSpoolman(origin = "http://spoolman.local:7912") {
  const vendors: Vendor[] = [];
  const filaments: Filament[] = [];
  const spools: Spool[] = [];
  const fields: { key: string; name: string; field_type: string }[] = [];
  const calls: { method: string; path: string; body?: Json }[] = [];
  let next = 1;
  const state = { loseAnswers: 0, down: false };

  const view = (s: Spool) => {
    const initial = s.initial_weight ?? (s.filament.weight as number | undefined) ?? null;
    return {
      ...s,
      remaining_weight: initial == null ? null : initial - s.used_weight,
    };
  };
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const notFound = () => json({ message: "Item not found" }, 404);

  function checkExtra(extra: unknown) {
    for (const [k, v] of Object.entries((extra ?? {}) as Record<string, unknown>)) {
      const f = fields.find((x) => x.key === k);
      if (!f) return `Unknown extra field ${k}`;
      if (typeof v !== "string") return `Extra ${k} isn't JSON text`;
      try {
        if (f.field_type === "text" && typeof JSON.parse(v) !== "string") return `${k} not text`;
      } catch {
        return `${k} isn't JSON`;
      }
    }
    return undefined;
  }

  function addSpool(
    s: {
      vendor?: string | null;
      material?: string;
      name?: string;
      colorHex?: string;
      weight?: number;
      initial?: number | null;
      used?: number;
      archived?: boolean;
    } = {},
  ): Spool {
    let vendor = s.vendor ? vendors.find((v) => v.name === s.vendor) : undefined;
    if (s.vendor && !vendor) {
      vendor = { id: next++, name: s.vendor };
      vendors.push(vendor);
    }
    const filament: Filament = {
      id: next++,
      name: s.name ?? "PLA Basic",
      vendor: vendor ?? null,
      material: s.material ?? "PLA",
      density: 1.24,
      diameter: 1.75,
      weight: s.weight ?? 1000,
      color_hex: s.colorHex ?? "29B2B2",
    };
    filaments.push(filament);
    const spool: Spool = {
      id: next++,
      filament,
      initial_weight: s.initial === undefined ? 1000 : s.initial,
      spool_weight: null,
      used_weight: s.used ?? 0,
      archived: s.archived ?? false,
      extra: {},
    };
    spools.push(spool);
    return spool;
  }

  async function handle(input: string, init: RequestInit = {}): Promise<Response> {
    if (state.down) throw new TypeError("fetch failed");
    const url = new URL(input);
    if (url.origin !== origin) throw new TypeError(`fetch failed: ${url.origin}`);
    const method = init.method ?? "GET";
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = init.body ? (JSON.parse(String(init.body)) as Json) : undefined;
    calls.push({ method, path, ...(body && { body }) });
    const answer = route(method, path, url, body);
    // A spool's write went through; its answer never arrives.
    if (method !== "GET" && path.startsWith("/spool") && state.loseAnswers > 0) {
      state.loseAnswers--;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return answer;
  }

  function route(method: string, path: string, url: URL, body?: Json): Response {
    if (path === "/info") return json({ version: "0.27.1" });
    if (path === "/field/spool" && method === "GET") return json(fields);
    const fieldKey = path.match(/^\/field\/spool\/(\w+)$/)?.[1];
    if (fieldKey && method === "POST") {
      if (!fields.some((f) => f.key === fieldKey))
        fields.push({
          key: fieldKey,
          name: String(body?.name),
          field_type: String(body?.field_type),
        });
      return json(fields);
    }
    if (path === "/vendor" && method === "GET") return json(vendors);
    if (path === "/vendor" && method === "POST") {
      const v = { id: next++, name: String(body?.name) };
      vendors.push(v);
      return json(v);
    }
    if (path === "/filament" && method === "GET") return json(filaments);
    if (path === "/filament" && method === "POST") {
      const { vendor_id, ...rest } = body ?? {};
      const f: Filament = {
        ...rest,
        id: next++,
        vendor: vendors.find((v) => v.id === vendor_id) ?? null,
      };
      filaments.push(f);
      return json(f);
    }
    if (path === "/spool" && method === "GET") {
      const all = url.searchParams.get("allow_archived") === "true";
      return json(spools.filter((s) => all || !s.archived).map(view));
    }
    if (path === "/spool" && method === "POST") {
      const bad = checkExtra(body?.extra);
      if (bad) return json({ message: bad }, 400);
      const filament = filaments.find((f) => f.id === body?.filament_id);
      if (!filament) return json({ message: "No filament" }, 400);
      const initial = (body?.initial_weight as number | undefined) ?? null;
      const full = initial ?? (filament.weight as number | undefined) ?? 0;
      const remaining = body?.remaining_weight as number | undefined;
      const s: Spool = {
        id: next++,
        filament,
        initial_weight: initial,
        spool_weight: (body?.spool_weight as number | undefined) ?? null,
        used_weight: remaining != null ? full - remaining : 0,
        archived: false,
        extra: (body?.extra as Record<string, string>) ?? {},
      };
      spools.push(s);
      return json(view(s));
    }
    const id = Number(path.match(/^\/spool\/(\d+)$/)?.[1]);
    const spool = spools.find((s) => s.id === id);
    if (id && !spool) return notFound();
    if (spool && method === "GET") return json(view(spool));
    if (spool && method === "PATCH") {
      if (body?.extra !== undefined) {
        const bad = checkExtra(body.extra);
        if (bad) return json({ message: bad }, 400);
        spool.extra = { ...(body.extra as Record<string, string>) };
      }
      if (typeof body?.used_weight === "number") spool.used_weight = body.used_weight;
      return json(view(spool));
    }
    return json({ message: "Not here" }, 404);
  }

  return {
    origin,
    handle,
    addSpool,
    spools,
    vendors,
    filaments,
    fields,
    calls,
    state,
    /** The writes the adapter made. */
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}
