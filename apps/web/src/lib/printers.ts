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
import type { TFunction } from "i18next";
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

// Notes of any entity with a timeline; `base` is its API path, "/api/printers/<id>" or
// "/api/accessories/<id>". The query key follows it: ["printers", <id>, "comments"].
export type Note = Pick<PrinterComment, "id" | "body" | "pinned" | "status" | "createdAt">;
const commentsKey = (base: string) => [...base.split("/").slice(2), "comments"];

export const useComments = (base: string) =>
  useQuery({
    queryKey: commentsKey(base),
    queryFn: () => api<Note[]>("GET", `${base}/comments`),
  });

function useCommentMutation<V>(base: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(base) }),
  });
}

export const useAddComment = (base: string) =>
  useCommentMutation(base, (v: CommentInput) => api("POST", `${base}/comments`, v));

export const usePatchComment = (base: string) =>
  useCommentMutation(base, (v: { commentId: string; patch: CommentPatch }) =>
    api("PATCH", `${base}/comments/${v.commentId}`, v.patch),
  );

export const useDeleteComment = (base: string) =>
  useCommentMutation(base, (commentId: string) => api("DELETE", `${base}/comments/${commentId}`));

/** The name a printer goes by everywhere: "02-Bambu A1". The server builds the same in `printerLabel`. */
export const printerName = (t: TFunction, p: Pick<Printer, "number" | "name">) =>
  t("common:printerName", { number: String(p.number).padStart(2, "0"), name: p.name });
