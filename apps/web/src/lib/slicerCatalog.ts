import type { SlicerZipSource } from "@3d-maker-suite/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

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
