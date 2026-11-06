import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Column } from "../../components/DataTable.tsx";
import { cx } from "../../lib/cx.ts";

type Sourced = { source?: string };

/**
 * A catalog row's source (ADR-0020): "By hand", "Bambu Studio (system)", "Bambu Cloud". `source`
 * is "hand", a profile's `<library>:system|user`, or the slicer library or account that imported
 * one of the four catalog types. A profile with none is an older hand-made one.
 */
export function sourceLabel(t: TFunction, source: string, profile = false) {
  if (source === "hand") return t(profile ? "catalog:source.handOlder" : "catalog:source.hand");
  const [product = source, scope] = source.split(":");
  const name = t(`filament:library.sources.${product}`, {
    defaultValue: t(`integrations:adapters.${product}.name`, { defaultValue: product }),
  });
  if (scope === "system") return t("catalog:source.system", { name });
  if (scope === "user") return t("catalog:source.user", { name });
  return name;
}

export function SourceBadge({ source, profile }: { source?: string; profile?: boolean }) {
  const { t } = useTranslation();
  if (!source) return null;
  const hand = source === "hand";
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        !hand && "bg-accent-soft text-accent",
        hand && !profile && "border border-border text-muted",
        hand && profile && "bg-warn/15 text-warn",
      )}
    >
      {sourceLabel(t, source, profile)}
    </span>
  );
}

/**
 * The Source column, filtered by the sources `all` (the whole table, not one page) has.
 * `profile`: a hand-made row is an older one.
 */
export function sourceColumn<T extends Sourced>(
  t: TFunction,
  all: Sourced[],
  profile = false,
): Column<T> {
  const sources = [...new Set(["hand", ...all.flatMap((r) => (r.source ? [r.source] : []))])];
  return {
    id: "source",
    header: t("catalog:source.column"),
    cell: (r) => <SourceBadge source={r.source} profile={profile} />,
    sort: "source",
    filter: "source",
    filterOptions: sources
      .map((s) => ({ value: s, label: sourceLabel(t, s, profile) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** In use / Unused on a profile: a plate, printer, print or an older version still uses it. */
export function useColumn<T extends { use?: "used" | "unused" }>(t: TFunction): Column<T> {
  return {
    id: "use",
    header: t("catalog:use.column"),
    cell: (r) =>
      r.use && (
        <span
          className={cx(
            "inline-flex items-center gap-1.5 whitespace-nowrap",
            r.use === "unused" && "text-muted",
          )}
        >
          <span
            aria-hidden
            className={cx(
              "size-2 rounded-full",
              r.use === "used" ? "bg-ok" : "border border-muted",
            )}
          />
          {r.use === "used" ? t("catalog:use.used") : t("catalog:use.unused")}
        </span>
      ),
    sort: "use",
    filter: "use",
    filterOptions: [
      { value: "used", label: t("catalog:use.used") },
      { value: "unused", label: t("catalog:use.unused") },
    ],
  };
}
