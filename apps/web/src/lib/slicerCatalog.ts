import type { CatalogImport, CatalogPreview, SLICER_CATALOG_TYPES } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export type CatalogType = (typeof SLICER_CATALOG_TYPES)[number];

export const useCatalogPreview = (id: string, type: CatalogType) =>
  useQuery({
    queryKey: ["slicer-catalog", id, type],
    queryFn: () => api<CatalogPreview>("GET", `/api/slicer-catalog/${id}/${type}`),
    retry: false,
    gcTime: 0, // always re-read the folder when the page opens
  });

export const useCatalogImport = (id: string, type: CatalogType) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CatalogImport) =>
      api<{ created: number }>("POST", `/api/slicer-catalog/${id}/${type}/import`, v),
    onSuccess: () => qc.invalidateQueries(),
  });
};
