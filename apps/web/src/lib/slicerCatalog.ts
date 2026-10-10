import type {
  CatalogImport,
  CatalogPreview,
  SLICER_ZIP_TYPES,
  SlicerZipSource,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export type CatalogType = (typeof SLICER_ZIP_TYPES)[number];
/** An integration reads its own folder; an uploaded zip is read like one. */
export type CatalogBase = "slicer-catalog" | "slicer-zip";

export const useCatalogPreview = (id: string, type: CatalogType, base: CatalogBase) =>
  useQuery({
    queryKey: [base, id, type],
    queryFn: () => api<CatalogPreview>("GET", `/api/${base}/${id}/${type}`),
    retry: false,
    gcTime: 0, // always re-read the folder when the page opens
  });

export const useCatalogImport = (id: string, type: CatalogType, base: CatalogBase) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CatalogImport) =>
      api<{ created: number }>("POST", `/api/${base}/${id}/${type}/import`, v),
    onSuccess: () => qc.invalidateQueries(),
  });
};

export const useZipSources = () =>
  useQuery({
    queryKey: ["slicer-zip", "sources"],
    queryFn: () => api<SlicerZipSource[]>("GET", "/api/slicer-zip/sources"),
  });

/** Resolves to the upload id; rejects with the server's error code (`invalid_zip`, ...). */
export const useZipUpload = (source: string) =>
  useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch(`/api/slicer-zip/${encodeURIComponent(source)}`, {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: file,
      });
      if (res.ok) return ((await res.json()) as { uploadId: string }).uploadId;
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      throw new Error(body?.error?.code ?? "error");
    },
  });
