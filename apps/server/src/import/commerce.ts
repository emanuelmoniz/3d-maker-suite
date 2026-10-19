import {
  type CostBreakdown,
  computeQuote,
  type ImportCell,
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  lower,
  matchClientRows,
  matchNumberedRows,
  type QuoteBreakdown,
  type QuoteSettings,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { unique } from "../lib/clients.ts";
import {
  assertNumberFree,
  freeNumber,
  nextNumber,
  numberCell,
  PAD,
  padded,
} from "../lib/numbers.ts";
import { setProjects } from "../lib/orders.ts";
import { readPreferences } from "../lib/preferences.ts";
import { find, printImport, projectRef, type Ref, refOf } from "./prints.ts";

const { clients, orderProjects, orders, quotes } = schema;

const num = (c: ImportCell | undefined) => (typeof c === "number" ? c : null);
const str = (c: ImportCell | undefined) => (typeof c === "string" ? c : null);
const cell = (c: ImportCell | undefined) => (c == null ? "" : String(c).trim());
const minor = (major: number) => Math.round(major * 100);
type Error = { column: string; code: ImportErrorCode };

/** A cell that names a row: empty is fine, anything else must be exactly one row. */
const bad = (ref: Ref, column: string, c: ImportCell | undefined): Error[] =>
  cell(c) && !find(ref, c) ? [{ column, code: "unresolved" }] : [];
/** The cell as the display name of the row it means (the spelling the targets use). */
const label = (ref: Ref, c: ImportCell | undefined) => {
  const id = find(ref, c);
  return (id && ref.labels.get(id)) || (c ?? null);
};

const quoteTitle = (q: { number: number | null; name: string }) =>
  q.number == null ? q.name : `${padded(q.number, PAD.quote)}-${q.name}`;

type Look = { clients: Ref; quotes: Ref; projects: Ref };
function build(db: Db): Look {
  const rows = db.select().from(clients).all();
  // A name two clients share is told apart by the mobile.
  const shared = (name: string) => rows.filter((c) => lower(c.name) === lower(name)).length > 1;
  return {
    clients: refOf(
      rows.map((c) => ({
        id: c.id,
        number: null,
        keys: [
          shared(c.name) ? `${c.name} (${c.mobile})` : c.name,
          c.name,
          c.mobile,
          c.email ?? "",
        ],
      })),
    ),
    quotes: refOf(
      db
        .select({ id: quotes.id, number: quotes.number, name: quotes.name })
        .from(quotes)
        .all()
        .map((q) => ({ ...q, keys: [quoteTitle(q), q.name] })),
    ),
    projects: projectRef(db),
  };
}
// A preview or an apply runs in one synchronous stretch (see `lookups` in prints.ts).
let cached: { db: Db; look: Look } | null = null;
function lookups(db: Db): Look {
  if (cached?.db !== db) {
    cached = { db, look: build(db) };
    queueMicrotask(() => {
      cached = null;
    });
  }
  return cached.look;
}

/** The names the template's dropdowns offer, in number order. */
const names = (ref: Ref) => [...ref.labels.values()];

/** Clients from a file: by mobile, else email, else VAT number. Never created by another type. */
export const clientImport = {
  targets: (db: Db): ImportTarget[] =>
    db
      .select()
      .from(clients)
      .orderBy(clients.name)
      .all()
      .map((c) => ({
        id: c.id,
        label: c.name,
        values: {
          name: c.name,
          mobile: c.mobile,
          vat: c.vat,
          email: c.email,
          address: c.address,
          notes: c.notes,
        },
      })),
  match: matchClientRows,
  missing: () => ({}),
  check: (_db: Db, v: ImportValues): Error[] =>
    cell(v.email) && !z.email().safeParse(cell(v.email)).success
      ? [{ column: "email", code: "not_an_email" }]
      : [],
  create(db: Db, v: ImportValues) {
    unique(() =>
      db
        .insert(clients)
        .values({
          name: str(v.name) ?? "",
          mobile: str(v.mobile) ?? "",
          vat: str(v.vat),
          email: str(v.email),
          address: str(v.address),
          notes: str(v.notes),
        })
        .run(),
    );
  },
  /** The keys are named like the columns. */
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    if (Object.keys(patch).length)
      unique(() => db.update(clients).set(patch).where(eq(clients.id, target.id)).run());
  },
};

/** What a quote typed in costs: one filament row that comes to exactly the production cost. */
const typedPrint = (unitCost: number) => ({
  uploads: [],
  plates: [],
  printerId: "",
  powerW: 0,
  minutes: 0,
  filaments: [{ label: "", grams: 1000, price: unitCost / 100 }],
});
const typedCost = (unitCost: number): CostBreakdown => ({
  material: unitCost,
  energy: 0,
  wear: 0,
  maintenance: 0,
  total: unitCost,
  unpricedGrams: 0,
});
const PRICING = [
  "unitCost",
  "quantity",
  "laborHours",
  "laborRate",
  "failureMarginPct",
  "markupPct",
];

/** The pricing cells (empty = the Costs defaults) as the calculator's settings. */
function settingsOf(db: Db, v: ImportValues): QuoteSettings {
  const prefs = readPreferences(db);
  return {
    laborHours: num(v.laborHours) ?? 0,
    laborRatePerHour: num(v.laborRate) ?? minor(prefs.laborRatePerHour),
    failureMarginPct: num(v.failureMarginPct) ?? prefs.failureMarginPct,
    markupPct: num(v.markupPct) ?? prefs.markupPct,
    quantity: num(v.quantity) ?? 1,
  };
}
const formOf = (s: QuoteSettings) => ({
  quantity: s.quantity,
  laborHours: s.laborHours,
  laborRate: s.laborRatePerHour / 100,
  failureMarginPct: s.failureMarginPct,
  markupPct: s.markupPct,
});

/** Quotes from a file: a number is the quote, else its name. */
export const quoteImport = {
  targets(db: Db): ImportTarget[] {
    const look = lookups(db);
    return db
      .select()
      .from(quotes)
      .orderBy(quotes.number)
      .all()
      .map((q) => {
        const form = q.form as Record<string, unknown>;
        const n = (k: string) => (typeof form[k] === "number" ? (form[k] as number) : null);
        const b = q.quote as QuoteBreakdown;
        return {
          id: q.id,
          label: quoteTitle(q),
          values: {
            number: q.number,
            name: q.name,
            client: (q.clientId && look.clients.labels.get(q.clientId)) || null,
            project: (q.projectId && look.projects.labels.get(q.projectId)) || null,
            unitCost: b.unitCost,
            quantity: b.quantity,
            laborHours: n("laborHours"),
            laborRate: n("laborRate") == null ? null : minor(n("laborRate") as number),
            failureMarginPct: n("failureMarginPct"),
            markupPct: n("markupPct"),
            notes: q.notes,
          },
        };
      });
  },
  match: matchNumberedRows("name"),
  canon: (db: Db, v: ImportValues): ImportValues => ({
    ...v,
    client: label(lookups(db).clients, v.client),
    project: label(lookups(db).projects, v.project),
  }),
  refs: (db: Db) => ({ clients: names(lookups(db).clients), projects: activeProjects(db) }),
  missing: () => ({}),
  check: (db: Db, v: ImportValues): Error[] => [
    ...bad(lookups(db).clients, "client", v.client),
    ...bad(lookups(db).projects, "project", v.project),
    ...(v.quantity != null && (num(v.quantity) ?? 0) < 1
      ? [{ column: "quantity", code: "negative" as const }]
      : []),
  ],
  create(db: Db, v: ImportValues) {
    const look = lookups(db);
    const unitCost = num(v.unitCost) ?? 0;
    const s = settingsOf(db, v);
    const projectId = find(look.projects, v.project);
    db.insert(quotes)
      .values({
        number: freeNumber(db, quotes, numberCell(v.number)) ?? nextNumber(quotes),
        name: str(v.name) ?? "",
        notes: str(v.notes),
        clientId: find(look.clients, v.client),
        projectId,
        form: { projectId: projectId ?? "", ...typedPrint(unitCost), ...formOf(s) },
        cost: typedCost(unitCost),
        quote: computeQuote(unitCost, s),
      })
      .run();
  },
  /** Writes `patch` (only the values that change); pricing is worked out again from the result. */
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const cur = db.select().from(quotes).where(eq(quotes.id, target.id)).get();
    if (!cur) return;
    const look = lookups(db);
    const set: Partial<typeof quotes.$inferInsert> = {};
    if ("name" in patch) set.name = str(patch.name) ?? cur.name;
    if ("notes" in patch) set.notes = str(patch.notes);
    if ("number" in patch) {
      set.number = numberCell(patch.number) ?? cur.number;
      assertNumberFree(db, quotes, "quote", numberCell(patch.number), cur.id);
    }
    if ("client" in patch) set.clientId = find(look.clients, patch.client);
    if ("project" in patch) set.projectId = find(look.projects, patch.project);
    let form = cur.form as Record<string, unknown>;
    if ("project" in patch) form = { ...form, projectId: set.projectId ?? "" };
    if (PRICING.some((k) => k in patch)) {
      const v = { ...target.values, ...patch };
      const unitCost = num(v.unitCost) ?? (cur.quote as QuoteBreakdown).unitCost;
      const s = settingsOf(db, v);
      form = { ...form, ...formOf(s), ...("unitCost" in patch && typedPrint(unitCost)) };
      set.cost = "unitCost" in patch ? typedCost(unitCost) : cur.cost;
      set.quote = computeQuote(unitCost, s);
    }
    set.form = form;
    db.update(quotes).set(set).where(eq(quotes.id, cur.id)).run();
  },
};

const activeProjects = (db: Db) => printImport.refs(db).projects;

/** The projects a cell names, `;` apart ("1-Box; 2-Lid"): each one, and the ones that don't resolve. */
const projectCells = (db: Db, c: ImportCell | undefined) => {
  const parts = cell(c)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const ref = lookups(db).projects;
  const found = parts.map((p) => ({ part: p, id: find(ref, p) }));
  return {
    ids: [...new Set(found.flatMap((f) => (f.id ? [f.id] : [])))],
    unresolved: found.some((f) => !f.id),
  };
};

/** Orders from a file: a number is the order; one without a number is always new. */
export const orderImport = {
  targets(db: Db): ImportTarget[] {
    const look = lookups(db);
    const byOrder = new Map<string, string[]>();
    for (const op of db.select().from(orderProjects).all())
      byOrder.set(op.orderId, [
        ...(byOrder.get(op.orderId) ?? []),
        look.projects.labels.get(op.projectId) ?? "",
      ]);
    return db
      .select()
      .from(orders)
      .orderBy(orders.number)
      .all()
      .map((o) => ({
        id: o.id,
        label: padded(o.number, PAD.order),
        values: {
          number: o.number,
          client: (o.clientId && look.clients.labels.get(o.clientId)) || null,
          quote: (o.quoteId && look.quotes.labels.get(o.quoteId)) || null,
          project: (byOrder.get(o.id) ?? []).sort().join("; "),
          price: o.price,
          status: o.status,
          notes: o.notes,
        },
      }));
  },
  match: matchNumberedRows(),
  canon(db: Db, v: ImportValues): ImportValues {
    const look = lookups(db);
    const status = readPreferences(db).orderStatuses.find((s) => lower(s) === lower(v.status));
    return {
      ...v,
      client: label(look.clients, v.client),
      quote: label(look.quotes, v.quote),
      project: cell(v.project)
        .split(";")
        .map((p) => String(label(look.projects, p.trim()) ?? ""))
        .filter(Boolean)
        .sort()
        .join("; "),
      status: status ?? v.status ?? null,
    };
  },
  refs: (db: Db) => ({
    clients: names(lookups(db).clients),
    quotes: names(lookups(db).quotes),
    projects: activeProjects(db),
  }),
  missing: () => ({}),
  check(db: Db, v: ImportValues): Error[] {
    const look = lookups(db);
    const errors = [
      ...bad(look.clients, "client", v.client),
      ...bad(look.quotes, "quote", v.quote),
    ];
    const projects = projectCells(db, v.project);
    if (!projects.ids.length || projects.unresolved)
      errors.push({ column: "project", code: "unresolved" });
    if (
      cell(v.status) &&
      !readPreferences(db).orderStatuses.some((s) => lower(s) === lower(v.status))
    )
      errors.push({ column: "status", code: "not_an_option" });
    return errors;
  },
  create(db: Db, v: ImportValues) {
    const look = lookups(db);
    const row = db
      .insert(orders)
      .values({
        number: freeNumber(db, orders, numberCell(v.number)) ?? nextNumber(orders),
        clientId: find(look.clients, v.client),
        quoteId: find(look.quotes, v.quote),
        price: num(v.price) ?? 0,
        status: str(v.status) ?? (readPreferences(db).orderStatuses[0] as string),
        notes: str(v.notes),
      })
      .returning({ id: orders.id })
      .get();
    setProjects(db, row.id, projectCells(db, v.project).ids);
  },
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const look = lookups(db);
    const { client, quote, project, ...rest } = patch;
    const set: Partial<typeof orders.$inferInsert> = {};
    if ("number" in rest) {
      set.number = numberCell(rest.number) ?? undefined;
      assertNumberFree(db, orders, "order", numberCell(rest.number), target.id);
    }
    if ("price" in rest) set.price = num(rest.price) ?? undefined;
    if ("status" in rest) set.status = str(rest.status) ?? undefined;
    if ("notes" in rest) set.notes = str(rest.notes);
    if (client !== undefined) set.clientId = find(look.clients, client);
    if (quote !== undefined) set.quoteId = find(look.quotes, quote);
    if (Object.keys(set).length) db.update(orders).set(set).where(eq(orders.id, target.id)).run();
    if (project !== undefined) setProjects(db, target.id, projectCells(db, project).ids);
  },
};
