import type { ImportPreview, ImportPreviewRow } from "@3d-maker-suite/core";
import type { buildApp } from "./app.ts";

type App = Awaited<ReturnType<typeof buildApp>>;

/** Test helper: opens the review of a source and confirms rows of it, as the review screen does. */
export const reviewer = (app: () => App) => ({
  open: (url: string) => app().inject({ method: "POST", url }),
  rows: async (url: string) =>
    ((await app().inject({ method: "POST", url })).json() as ImportPreview).rows.map(
      (r) => `${r.values.name ?? r.values.profile}:${r.status}`,
    ),
  /** Confirms the suggested action of `rows` (default: every row not suggested to skip). */
  confirm: (
    p: ImportPreview,
    rows: ImportPreviewRow[] = p.rows.filter((r) => r.action !== "skip"),
    over: { action?: "create" | "update"; refs?: Record<string, string> } = {},
  ) =>
    app().inject({
      method: "POST",
      url: `/api/import/${p.entity}/apply`,
      payload: {
        uploadId: p.uploadId,
        policy: "overwrite",
        decisions: rows.map((r) => ({
          row: r.row,
          action: over.action ?? (r.action === "update" ? "update" : "create"),
          targetId: r.targetId ?? undefined,
          refs:
            over.refs ??
            Object.fromEntries(
              Object.entries(r.refs ?? {}).flatMap(([k, v]) => (v ? [[k, v]] : [])),
            ),
        })),
      },
    }),
});
