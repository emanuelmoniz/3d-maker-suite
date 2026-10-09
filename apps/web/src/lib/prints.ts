import type {
  FilamentReviewItem,
  Page,
  PrintDetail,
  PrintInput,
  PrintPatch,
} from "@3d-maker-suite/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { useListPage } from "./list.ts";

/** `query` is the raw list query (page, sort, column filters), e.g. the page's URL search params. */
export const usePrints = (query: Record<string, string> = {}) =>
  useQuery({
    queryKey: ["prints", "list", query],
    queryFn: () => api<Page<PrintDetail>>("GET", `/api/prints?${new URLSearchParams(query)}`),
    placeholderData: keepPreviousData,
  });

export const usePrintsOfProject = (projectId: string) =>
  useQuery({
    queryKey: ["prints", "project", projectId],
    queryFn: () =>
      api<Page<PrintDetail>>(
        "GET",
        `/api/prints?pageSize=100&sort=-startedAt&projectId=${projectId}`,
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

export const useFilamentReview = (query: Record<string, string> = {}) =>
  useListPage<FilamentReviewItem>(["prints", "review"], "/api/prints/filament-review", query);

export const useAssignReview = () =>
  useInvalidating((v: { usageId: string; spoolId: string }) =>
    api("POST", `/api/prints/filament-review/${v.usageId}/assign`, { spoolId: v.spoolId }),
  );

export const useDismissReview = () =>
  useInvalidating((usageIds: string[]) =>
    api("POST", "/api/prints/filament-review/dismiss", { usageIds }),
  );
