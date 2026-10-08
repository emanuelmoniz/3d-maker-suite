import type { Page, PrintDetail, PrintInput, PrintPatch } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

// ponytail: one page of 100 prints, add pagination controls if anyone logs more.
export const usePrints = (tagId = "") =>
  useQuery({
    queryKey: ["prints", "list", tagId],
    queryFn: () =>
      api<Page<PrintDetail>>(
        "GET",
        `/api/prints?pageSize=100&sort=-startedAt${tagId ? `&tagId=${tagId}` : ""}`,
      ),
  });

export const usePrint = (id: string) =>
  useQuery({
    queryKey: ["prints", id],
    queryFn: () => api<PrintDetail>("GET", `/api/prints/${id}`),
  });

/** Runs a mutation, then refreshes prints and spools (weights change with every print). */
function useInvalidating<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["prints"] }),
        qc.invalidateQueries({ queryKey: ["filament"] }),
        qc.invalidateQueries({ queryKey: ["printers"] }),
      ]),
  });
}

export const useCreatePrint = () =>
  useInvalidating((v: PrintInput) => api<PrintDetail>("POST", "/api/prints", v));

export const usePatchPrint = (id: string) =>
  useInvalidating((v: PrintPatch) => api<PrintDetail>("PATCH", `/api/prints/${id}`, v));

export const useDeletePrint = () =>
  useInvalidating((id: string) => api("DELETE", `/api/prints/${id}`));
