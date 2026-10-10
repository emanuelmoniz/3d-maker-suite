import type {
  ImportApply,
  ImportEntity,
  ImportPreview,
  ImportResult,
  ImportTemplate,
} from "@3d-maker-suite/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Builds the template on the server (translated texts go along) and saves it as `filename`. */
export const useTemplate = (entity: ImportEntity) =>
  useMutation({
    mutationFn: async (v: { filename: string; body: ImportTemplate }) => {
      const res = await fetch(`/api/import/${entity}/template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v.body),
      });
      if (!res.ok) throw new Error(`template failed: ${res.status}`);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = v.filename;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  });

/** Uploads a file for review. `labels` are the translated headers, so they map back to columns. */
export const usePreview = (entity: ImportEntity) =>
  useMutation({
    mutationFn: (v: { file: File; labels: Record<string, string> }) =>
      api<ImportPreview>(
        "POST",
        `/api/import/${entity}/preview?labels=${encodeURIComponent(JSON.stringify(v.labels))}`,
        // The browser's own type for a .csv depends on the OS, so the extension decides.
        new Blob([v.file], { type: /\.csv$/i.test(v.file.name) ? "text/csv" : XLSX }),
      ),
  });

export const useApply = (entity: ImportEntity) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ImportApply) => api<ImportResult>("POST", `/api/import/${entity}/apply`, v),
    // An import can touch any list (and adds a backup), so everything is refetched.
    onSuccess: () => qc.invalidateQueries(),
  });
};
