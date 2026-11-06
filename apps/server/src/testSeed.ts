import { type openDb, schema } from "@3d-maker-suite/db";

type App = {
  inject: (o: object) => Promise<{ statusCode: number; body: string; json: () => { id: string } }>;
};

export const QUOTE_BODY = {
  name: "Vase",
  form: {},
  cost: { material: 1, energy: 1, wear: 0, maintenance: 0, total: 2, unpricedGrams: 0 },
  quote: {
    unitCost: 2,
    labor: 0,
    failureMargin: 0,
    subtotal: 2,
    markup: 0,
    unitPrice: 2,
    quantity: 1,
    total: 2,
  },
};

type ProfileKind = "machineProfiles" | "printProfiles" | "filamentProfiles";
let presets = 0;

/**
 * A profile as a slicer import leaves it (ADR-0020: no API makes one): from `bambu-studio`'s system
 * presets unless `values` names its `sourcePreset` (`null` = an older hand-made one).
 */
export function insertProfile<K extends ProfileKind>(
  db: ReturnType<typeof openDb>,
  kind: K,
  values: Partial<(typeof schema)[K]["$inferInsert"]>,
): (typeof schema)[K]["$inferSelect"] {
  const table = schema[kind] as typeof schema.filamentProfiles;
  const name = (values as { name?: string }).name ?? "";
  return db
    .insert(table)
    .values({
      sourcePreset: `bambu-studio:system/${name || "preset"} ${++presets}`,
      ...(kind === "filamentProfiles" && { name: "", densityGcm3: 1.24 }),
      ...(values as object),
    } as never)
    .returning()
    .get() as never;
}

/** One row of each of the 16 (ADR-0018), wired together the way real data is. */
export async function seedOneOfEach(app: App, db: ReturnType<typeof openDb>) {
  const made = async (url: string, payload: object) => {
    const res = await app.inject({ method: "POST", url, payload });
    if (res.statusCode !== 201) throw new Error(`POST ${url}: ${res.body}`);
    return res.json();
  };
  const brand = await made("/api/brands", { name: "Acme" });
  const model = await made("/api/printer-models", { brandId: brand.id, model: "X1" });
  const machine = insertProfile(db, "machineProfiles", { name: "M", printerModelId: model.id });
  const printProfile = insertProfile(db, "printProfiles", { name: "Fine" });
  const printer = await made("/api/printers", {
    name: "P",
    modelId: model.id,
    state: "working",
    powerW: 100,
  });
  const accessory = await made("/api/accessories", { name: "AMS", type: "AMS", state: "working" });
  const type = db.insert(schema.maintenanceTypes).values({ name: "Oil" }).returning().get();
  const filamentBrand = await made("/api/filament-brands", { name: "Acme" });
  const material = await made("/api/filament-materials", { name: "PLA" });
  const profile = insertProfile(db, "filamentProfiles", {
    brandId: filamentBrand.id,
    materialId: material.id,
    densityGcm3: 1.24,
    name: "Basic",
  });
  const spool = await made("/api/filament/spools", {
    brandId: filamentBrand.id,
    materialId: material.id,
    name: "PLA Basic",
    initialGrams: 1000,
    pricePaid: 2000,
  });
  const project = await made("/api/projects", { name: "Vase" });
  const client = await made("/api/clients", { name: "Ana", mobile: "911" });
  const quote = await made("/api/costs/quotes", QUOTE_BODY);
  const order = await made("/api/orders", { projectIds: [project.id], price: 500 });
  const print = await made("/api/prints", {
    printerId: printer.id,
    projectId: project.id,
    orderId: order.id,
    title: "Body",
    startedAt: "2026-01-01T10:00:00.000Z",
    durationSec: 3600,
    outcome: "success",
    usages: [{ spoolId: spool.id, grams: 50 }],
  });
  return {
    brand,
    model,
    machine,
    printProfile,
    printer,
    accessory,
    type,
    filamentBrand,
    material,
    profile,
    spool,
    project,
    client,
    quote,
    order,
    print,
  };
}
