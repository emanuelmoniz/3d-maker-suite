import {
  type Brand,
  type FilamentBrand,
  type FilamentMaterial,
  type MachineProfile,
  modelLabel,
  type Page,
  type PrinterModel,
  type PrintProfile,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { withOwn } from "./list.ts";

/** API path segment of each catalog entity, and its image endpoint (if any). */
export type CatalogKind =
  | "brands"
  | "printer-models"
  | "machine-profiles"
  | "print-profiles"
  | "filament-brands"
  | "filament-materials";
type Row = {
  brands: Brand;
  "printer-models": PrinterModel;
  "machine-profiles": MachineProfile;
  "print-profiles": PrintProfile;
  "filament-brands": FilamentBrand;
  "filament-materials": FilamentMaterial;
};
export type CatalogRow<K extends CatalogKind> = Row[K];

export const IMAGE_OF = {
  brands: "logo",
  "printer-models": "image",
  "filament-brands": "logo",
} as const;

/** The permission module that manages a catalog. */
export const catalogModule = (kind: CatalogKind) =>
  kind.startsWith("filament") ? "filament" : "printers";

/** Every active row of a catalog (the API caps a page at 100); archived too to name what a row points at. */
const useAll = <K extends CatalogKind>(kind: K, withArchived = false) =>
  useQuery({
    queryKey: ["catalog", kind, withArchived ? "withArchived" : "all"],
    queryFn: async () => {
      const get = (page: number) =>
        api<Page<Row[K]>>(
          "GET",
          `/api/${kind}?pageSize=100&page=${page}${withArchived ? "&archived=all" : ""}`,
        );
      const first = await get(1);
      const rest = await Promise.all(
        Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, i) => get(i + 2)),
      );
      return [first, ...rest].flatMap((p) => p.items);
    },
  });
export const useBrands = () => useAll("brands");
export const usePrinterModels = () => useAll("printer-models");
export const useMachineProfiles = () => useAll("machine-profiles");
export const usePrintProfiles = () => useAll("print-profiles");
export const useFilamentBrands = () => useAll("filament-brands");
export const useFilamentMaterials = () => useAll("filament-materials");
export const useCatalogWithArchived = <K extends CatalogKind>(kind: K) => useAll(kind, true);

/** One row; idle without `id` (create forms). */
export const useCatalogItem = <K extends CatalogKind>(kind: K, id?: string) =>
  useQuery({
    queryKey: ["catalog", kind, id],
    queryFn: () => api<Row[K]>("GET", `/api/${kind}/${id}`),
    enabled: Boolean(id),
  });

/** A picker's active rows, plus the one the row already has: saving must not lose it. */
export const useCatalogPicker = <K extends CatalogKind>(kind: K, own?: string | null) =>
  withOwn<Row[K]>(useAll(kind).data ?? [], useCatalogItem(kind, own ?? undefined).data);

/** Brand + model rows joined, by model id ("Bambu Lab P1S"), archived ones too: pickers filter them. */
export function useModelInfo() {
  const brands = new Map(useAll("brands", true).data?.map((b) => [b.id, b]));
  const models = useAll("printer-models", true).data ?? [];
  return new Map(
    models.map((m) => {
      const brand = brands.get(m.brandId);
      return [m.id, { model: m, brand, label: modelLabel(brand?.name, m.model) }];
    }),
  );
}

/** Catalog edits change printer and filament labels too, so those caches are refreshed. */
function useInvalidating<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["catalog"] }),
        qc.invalidateQueries({ queryKey: ["printers"] }),
        qc.invalidateQueries({ queryKey: ["filament"] }),
      ]),
  });
}

/** Create (no `id`) or patch. */
export const useSaveCatalog = <K extends CatalogKind>(kind: K, id?: string) =>
  useInvalidating((v: object) =>
    api<Row[K]>(id ? "PATCH" : "POST", id ? `/api/${kind}/${id}` : `/api/${kind}`, v),
  );

export const useCatalogImage = (kind: keyof typeof IMAGE_OF) =>
  useInvalidating((v: { id: string; file: File | null }) =>
    api(v.file ? "PUT" : "DELETE", `/api/${kind}/${v.id}/${IMAGE_OF[kind]}`, v.file ?? undefined),
  );

export const imageUrl = (kind: keyof typeof IMAGE_OF, row: { id: string; updatedAt: string }) =>
  `/api/${kind}/${row.id}/${IMAGE_OF[kind]}?v=${row.updatedAt}`;

/** `api()` errors end with the HTTP status; 409 = duplicate name on save. */
export const isConflict = (e: unknown) => String(e).endsWith(": 409");
