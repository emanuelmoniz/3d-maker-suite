import {
  REVIEWED_TYPES,
  type ReviewedType,
  type SyncType,
  type TypeSyncResult,
} from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { textLink } from "../lib/cx.ts";
import { formatList } from "../lib/format.ts";
import {
  useIntegrationLabel,
  useIntegrations,
  useMayTask,
  useSyncTargets,
  useSyncTypes,
} from "../lib/integrations.ts";
import { CAPS, ERRORS } from "../pages/settings/integrationLabels.ts";
import { AddDialog } from "./AddDialog.tsx";
import { Button } from "./Button.tsx";

/**
 * A page's Sync: `types`, now, in every source that has them on Auto and that the caller may sync
 * (the same rule the server applies). Hidden with no such source. A run that leaves rows for one
 * review queue goes there; otherwise a short result says what synced, what waits and what failed.
 * `all`: the page-wide button ("Sync all") rather than one table's.
 */
export function SyncButton({ types, all }: { types: readonly SyncType[]; all?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = useMayTask();
  const targets = useSyncTargets(types);
  const sync = useSyncTypes();
  const [results, setResults] = useState<TypeSyncResult[]>();
  const [written, setWritten] = useState<number>();
  if (targets.length === 0) return null;

  const run = () => {
    setWritten(undefined);
    sync.mutate([...new Set(targets.map((x) => x.type))], {
      onSuccess: ({ results: r }) => {
        const waiting = r.filter((x) => x.pending > 0);
        const only = waiting.length === 1 ? waiting[0] : undefined;
        if (only && isReviewedType(only.type) && may(only.integrationId, only.type, "review")) {
          void navigate({
            to: "/import/$source/$id/$type",
            params: { source: "integration", id: only.integrationId, type: only.type },
            search: { waiting: "1" } as never,
          });
          return;
        }
        if (r.some((x) => x.status !== "ok" || x.pending > 0)) setResults(r);
        else setWritten(r.reduce((n, x) => n + x.updated, 0));
      },
    });
  };
  const what = formatList(types.map((x) => t(CAPS[x])));

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        busy={sync.isPending}
        aria-label={all ? undefined : t("integrations:typeSync.of", { what })}
        onClick={run}
      >
        <RefreshCw className="size-4" aria-hidden />
        {t(all ? "integrations:typeSync.all" : "integrations:typeSync.button")}
      </Button>
      <span role="status" aria-live="polite" className="text-sm text-muted">
        {written !== undefined && t("integrations:typeSync.done", { count: written })}
      </span>
      <SyncResultDialog results={results} onClose={() => setResults(undefined)} />
    </span>
  );
}

function SyncResultDialog({
  results,
  onClose,
}: {
  results: TypeSyncResult[] | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = useIntegrationLabel();
  const list = useIntegrations().data ?? [];
  const may = useMayTask();
  return (
    <AddDialog open={!!results} title={t("integrations:typeSync.title")} onClose={onClose}>
      <ul className="grid gap-3">
        {results?.map((r) => {
          const source = list.find((i) => i.id === r.integrationId);
          return (
            <li key={`${r.integrationId}-${r.type}`} className="grid gap-0.5">
              <span className="font-medium">
                {t("integrations:typeSync.line", {
                  source: source ? label(source) : r.integrationId,
                  type: t(CAPS[r.type]),
                })}
              </span>
              {r.status === "ok" && (
                <span className="text-muted">
                  {t("integrations:typeSync.ok", { count: r.updated })}
                </span>
              )}
              {r.status === "ok" && r.pending > 0 && (
                <span className="flex flex-wrap items-center gap-2">
                  {t("integrations:typeSync.waiting", { count: r.pending })}
                  {isReviewedType(r.type) && may(r.integrationId, r.type, "review") && (
                    <Link
                      to="/import/$source/$id/$type"
                      params={{ source: "integration", id: r.integrationId, type: r.type }}
                      search={{ waiting: "1" } as never}
                      className={textLink}
                      onClick={onClose}
                    >
                      {t("integrations:typeSync.review")}
                    </Link>
                  )}
                </span>
              )}
              {r.status === "error" && r.code && r.code !== "sync_running" && (
                <span role="alert" className="text-bad">
                  {t("integrations:typeSync.failed", { reason: t(ERRORS[r.code]) })}
                </span>
              )}
              {r.status === "skipped" && (
                <span className="text-muted">
                  {t(
                    r.code === "sync_running"
                      ? "integrations:typeSync.running"
                      : "integrations:typeSync.skipped",
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </div>
    </AddDialog>
  );
}

/** Types whose rows wait on a review page (`/import/...`). */
const isReviewedType = (type: string): type is ReviewedType =>
  (REVIEWED_TYPES as readonly string[]).includes(type);
