import type { PresetSetting, PresetSettings } from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import { cx, textLink } from "../../lib/cx.ts";
import { sourceLabel } from "../catalog/sources.tsx";

// Static keys so `pnpm i18n:check` sees them.
const UNREADABLE = {
  hand_made: "catalog:settings.hand_made",
  not_found: "catalog:settings.not_found",
} as const;

/** Values longer than this fold to two lines until asked for (start G-code runs to hundreds). */
const LONG = 140;

/** A setting's value: folded when long, and wrapped so G-code and lists never widen the page. */
function Value({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = text.length > LONG || text.includes("\n");
  return (
    <>
      <span
        // `line-clamp` sets its own display, so `block` only goes with the unfolded text.
        className={cx(
          "whitespace-pre-wrap wrap-anywhere",
          long && !open ? "line-clamp-2" : "block",
        )}
      >
        {text || <span className="text-muted">{t("catalog:settings.empty")}</span>}
      </span>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`mt-0.5 text-sm ${textLink}`}
        >
          {open ? t("catalog:settings.fold") : t("catalog:settings.unfold")}
        </button>
      )}
    </>
  );
}

/** The layers a settings list draws on: the preset itself, then each parent or template it names. */
function layersOf(data: PresetSettings) {
  const seen = new Set(data.settings.map((s) => s.from));
  const named = data.settings.flatMap((s) => (s.from === null ? [] : [s.from]));
  return [
    ...(seen.has(null) ? [null] : []),
    ...[...new Set([...data.parents, ...named])].filter((p) => seen.has(p)),
  ];
}

function download(name: string, settings: PresetSetting[]) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(Object.fromEntries(settings.map((s) => [s.key, s.value])), null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Every key and value of a preset's slicer file, parents filled in (ADR-0020), read from its source
 * when the page opens. Each row says which layer it comes from; the layer chips, and the search,
 * narrow the list.
 */
export function AllSettings({ path, name }: { path: string; name: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState<string | null | undefined>(undefined);
  const { data, isError, isPending } = useQuery({
    queryKey: ["preset-settings", path],
    queryFn: () => api<PresetSettings>("GET", `${path}/settings`),
    // The file is the source of truth: read it again every time the page opens.
    staleTime: 0,
  });

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("catalog:settings.loadError")}
      </p>
    );
  if (isPending) return <p className="text-muted">{t("catalog:settings.loading")}</p>;

  const [library = ""] = (data.source ?? "").split(":");
  const slicer = sourceLabel(t, library);
  if (data.status === "unreadable")
    return (
      <p role="status" className="rounded-md border border-border bg-surface-2 p-3">
        {data.reason === "no_source" ? (
          <Trans
            t={t}
            i18nKey="catalog:settings.noSource"
            values={{ slicer }}
            components={{ integrations: <Link to="/integrations" className={textLink} /> }}
          />
        ) : (
          t(UNREADABLE[data.reason === "hand_made" ? "hand_made" : "not_found"], { slicer })
        )}
      </p>
    );

  const layers = layersOf(data);
  const q = query.trim().toLowerCase();
  const rows = data.settings.filter(
    (s) =>
      (layer === undefined || s.from === layer) &&
      (!q || s.key.toLowerCase().includes(q) || s.value.toLowerCase().includes(q)),
  );
  const count = (l: string | null) => data.settings.filter((s) => s.from === l).length;
  const chip = (active: boolean) =>
    cx(
      "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm",
      active
        ? "border-accent bg-accent-soft font-medium text-accent"
        : "border-border bg-surface hover:bg-surface-2",
    );

  return (
    <div className="grid gap-3">
      {data.waiting && (
        <p role="status" className="rounded-md border border-warn/40 bg-warn/10 p-3">
          <Trans
            t={t}
            i18nKey="catalog:settings.waiting"
            values={{ slicer, count: data.waiting.count }}
            components={{
              review: (
                <Link
                  to="/import/$source/$id/$type"
                  params={{
                    source: "integration",
                    id: data.waiting.integrationId,
                    type: data.waiting.type,
                  }}
                  className={textLink}
                />
              ),
            }}
          />
        </p>
      )}
      {data.missing && (
        <p role="status" className="rounded-md border border-warn/40 bg-warn/10 p-3">
          {t("catalog:settings.missing", { parent: data.missing, slicer })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("catalog:settings.search")}
          aria-label={t("catalog:settings.search")}
          className="h-9 w-full rounded-md border border-border bg-surface px-3 sm:w-72"
        />
        <Button className="sm:ml-auto" onClick={() => download(name, data.settings)}>
          <Download className="size-4" aria-hidden />
          {t("catalog:settings.download")}
        </Button>
      </div>

      {layers.length > 1 && (
        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{t("catalog:settings.layers")}</legend>
          <button
            type="button"
            aria-pressed={layer === undefined}
            className={chip(layer === undefined)}
            onClick={() => setLayer(undefined)}
          >
            {t("catalog:settings.all", { count: data.settings.length })}
          </button>
          {layers.map((l) => (
            <button
              key={l ?? "own"}
              type="button"
              aria-pressed={layer === l}
              className={chip(layer === l)}
              onClick={() => setLayer(layer === l ? undefined : l)}
            >
              {l === null ? t("catalog:settings.own") : l}
              <span className="text-muted">{count(l)}</span>
            </button>
          ))}
        </fieldset>
      )}

      <p aria-live="polite" className="text-muted">
        {t("catalog:settings.shown", { shown: rows.length, total: data.settings.length })}
      </p>

      {rows.length ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full border-collapse text-left">
            <thead className="sr-only sm:table-header-group">
              <tr className="border-b border-border bg-surface-2 text-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("catalog:settings.setting")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("catalog:settings.value")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("catalog:settings.from")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.key}
                  className={cx(
                    "block border-b border-l-2 border-border px-3 py-2 last:border-b-0 sm:table-row sm:px-0 sm:py-0",
                    s.from === null ? "border-l-accent bg-accent-soft/40" : "border-l-transparent",
                  )}
                >
                  <th
                    scope="row"
                    className="block break-all font-mono text-sm font-normal sm:table-cell sm:w-1/4 sm:px-3 sm:py-2 sm:align-top"
                  >
                    {s.key}
                  </th>
                  <td className="block sm:table-cell sm:px-3 sm:py-2 sm:align-top">
                    <Value text={s.value} />
                  </td>
                  <td
                    className={cx(
                      "block text-sm sm:table-cell sm:w-1/5 sm:px-3 sm:py-2 sm:align-top",
                      s.from === null ? "font-medium text-accent" : "text-muted",
                    )}
                  >
                    <span className="wrap-anywhere">
                      {s.from === null ? t("catalog:settings.own") : s.from}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">{t("catalog:settings.none", { query })}</p>
      )}
    </div>
  );
}
