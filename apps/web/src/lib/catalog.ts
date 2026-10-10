import type {
  Brand,
  FilamentBrand,
  FilamentMaterial,
  MachineProfile,
  Page,
  PrinterModel,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

/** API path segment of each catalog entity, and its image endpoint (if any). */
export type CatalogKind =
  | "brands"
  | "printer-models"
  | "machine-profiles"
  | "filament-brands"
  | "filament-materials";
type Row = {
  brands: Brand;
  "printer-models": PrinterModel;
  "machine-profiles": MachineProfile;
  "filament-brands": FilamentBrand;
  "filament-materials": FilamentMaterial;
};
export const IMAGE_OF = {
  brands: "logo",
  "printer-models": "image",
  "filament-brands": "logo",
} as const;

/** Every row of a catalog (the API caps a page at 100), for selects and labels. */
const useAll = <K extends CatalogKind>(kind: K) =>
  useQuery({
    queryKey: ["catalog", kind, "all"],
    queryFn: async () => {
      const get = (page: number) =>
        api<Page<Row[K]>>("GET", `/api/${kind}?pageSize=100&page=${page}`);
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
export const useFilamentBrands = () => useAll("filament-brands");
export const useFilamentMaterials = () => useAll("filament-materials");

/** One row; idle without `id` (create forms). */
export const useCatalogItem = <K extends CatalogKind>(kind: K, id?: string) =>
  useQuery({
    queryKey: ["catalog", kind, id],
    queryFn: () => api<Row[K]>("GET", `/api/${kind}/${id}`),
    enabled: Boolean(id),
  });

/** Brand + model rows joined, by model id ("Bambu Lab P1S"). */
export function useModelInfo() {
  const brands = new Map(useBrands().data?.map((b) => [b.id, b]));
  const models = usePrinterModels().data ?? [];
  return new Map(
    models.map((m) => {
      const brand = brands.get(m.brandId);
      return [m.id, { model: m, brand, label: `${brand?.name ?? ""} ${m.model}`.trim() }];
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

export const useDeleteCatalog = (kind: CatalogKind) =>
  useInvalidating((id: string) => api("DELETE", `/api/${kind}/${id}`));

export const useCatalogImage = (kind: keyof typeof IMAGE_OF) =>
  useInvalidating((v: { id: string; file: File | null }) =>
    api(v.file ? "PUT" : "DELETE", `/api/${kind}/${v.id}/${IMAGE_OF[kind]}`, v.file ?? undefined),
  );

export const imageUrl = (kind: keyof typeof IMAGE_OF, row: { id: string; updatedAt: string }) =>
  `/api/${kind}/${row.id}/${IMAGE_OF[kind]}?v=${row.updatedAt}`;

/** `api()` errors end with the HTTP status; 409 = duplicate name on save, still in use on delete. */
export const isConflict = (e: unknown) => String(e).endsWith(": 409");
