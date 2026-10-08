import type {
  CommentInput,
  CommentPatch,
  Page,
  Printer,
  PrinterComment,
  PrinterInput,
  PrinterPatch,
  PrintStats,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export type Period = { from?: string; to?: string };

const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return s.size ? `?${s}` : "";
};

// ponytail: one page of 100 printers, add pagination controls if anyone owns more.
export const usePrinters = (o: { state?: string; archived: boolean; tagId?: string }) =>
  useQuery({
    queryKey: ["printers", "list", o],
    queryFn: () =>
      api<Page<Printer>>(
        "GET",
        `/api/printers${qs({ state: o.state, tagId: o.tagId, archived: String(o.archived), pageSize: "100" })}`,
      ),
  });

export const usePrinter = (id: string) =>
  useQuery({
    queryKey: ["printers", id],
    queryFn: () => api<Printer>("GET", `/api/printers/${id}`),
  });

export const usePrinterStats = (id: string, period: Period) =>
  useQuery({
    queryKey: ["printers", id, "stats", period],
    queryFn: () => api<PrintStats>("GET", `/api/printers/${id}/stats${qs(period)}`),
  });

/** Runs a mutation, then refreshes everything printer-related. */
function useInvalidating<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["printers"] }),
  });
}

export const useCreatePrinter = () =>
  useInvalidating((v: PrinterInput) => api<Printer>("POST", "/api/printers", v));

export const usePatchPrinter = (id: string) =>
  useInvalidating((v: PrinterPatch) => api<Printer>("PATCH", `/api/printers/${id}`, v));

export const useUploadPhoto = (id: string) =>
  useInvalidating((file: File) => api<Printer>("PUT", `/api/printers/${id}/photo`, file));

export const useRemovePhoto = (id: string) =>
  useInvalidating(() => api("DELETE", `/api/printers/${id}/photo`));

export const photoUrl = (p: Printer) => `/api/printers/${p.id}/photo?v=${p.updatedAt}`;

export const useComments = (id: string) =>
  useQuery({
    queryKey: ["printers", id, "comments"],
    queryFn: () => api<PrinterComment[]>("GET", `/api/printers/${id}/comments`),
  });

export const useAddComment = (id: string) =>
  useInvalidating((v: CommentInput) => api("POST", `/api/printers/${id}/comments`, v));

export const usePatchComment = (id: string) =>
  useInvalidating((v: { commentId: string; patch: CommentPatch }) =>
    api("PATCH", `/api/printers/${id}/comments/${v.commentId}`, v.patch),
  );

export const useDeleteComment = (id: string) =>
  useInvalidating((commentId: string) =>
    api("DELETE", `/api/printers/${id}/comments/${commentId}`),
  );
