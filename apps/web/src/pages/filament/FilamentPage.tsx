import {
  type FilamentProfile,
  SPOOL_STATUSES,
  type Spool,
  spoolFilters,
  spoolPricePerKg,
} from "@3d-maker-suite/core";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Spool as SpoolIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { SyncButtons } from "../../components/ImportLinks.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { TagList } from "../../components/TagList.tsx";
import { Write } from "../../components/Write.tsx";
import { api } from "../../lib/api.ts";
import { spoolName, useProfiles } from "../../lib/filament.ts";
import { formatCurrency, formatWeight } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useTags, useTagsOf } from "../../lib/tags.ts";

export const STATUS = {
  new: "filament:spools.statuses.new",
  in_use: "filament:spools.statuses.in_use",
  empty: "filament:spools.statuses.empty",
} as const;
const addClass =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

const AddLink = ({ to, children }: { to: string; children: string }) => (
  <Write>
    <Link to={to} className={addClass}>
      <Plus className="size-4" aria-hidden />
      {children}
    </Link>
  </Write>
);

export function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: hex }}
    />
  );
}

export function FilamentPage() {
  const { t } = useTranslation();
  const prefs = usePreferences().data?.values;
  const [spoolQuery, setSpoolQuery] = useUrlListQuery("spools.");
  // A fresh visit starts on the spools in play; clearing the filter later shows all.
  useEffect(() => {
    if (!Object.keys(spoolQuery).length) setSpoolQuery({ status: "new,in_use" });
  }, []);
  const spools = useListPage<Spool>(
    ["filament", "spools", "table"],
    "/api/filament/spools",
    spoolQuery,
  );
  const allProfiles = useProfiles().data?.items;
  const profileOf = new Map(allProfiles?.map((p) => [p.id, p]));
  // Spools can point at archived profiles or ones past the first 100: fetch those by id.
  const missing = [...new Set(spools.data?.items.map((s) => s.profileId))].filter(
    (id) => allProfiles && !profileOf.has(id),
  );
  for (const q of useQueries({
    queries: missing.map((id) => ({
      queryKey: ["filament", "profile", id],
      queryFn: () => api<FilamentProfile>("GET", `/api/filament/profiles/${id}`),
    })),
  }))
    if (q.data) profileOf.set(q.data.id, q.data);
  const tagsOf = useTagsOf("spool");
  const tags = useTags().data ?? [];
  const spoolPrice = (s: Spool) => {
    const perKg = spoolPricePerKg(s, profileOf.get(s.profileId) ?? { pricePerKg: null });
    return perKg === null || s.initialGrams == null ? null : (perKg * s.initialGrams) / 1000;
  };

  return (
    <>
      <PageHeader
        title={t("nav:items.filament.label")}
        description={t("nav:items.filament.description")}
        actions={<SettingsLink module="filament" />}
      />
      {spools.isError && (
        <p role="alert" className="text-bad">
          {t("filament:loadError")}
        </p>
      )}
      <div className="grid gap-8">
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("filament:spools.title")}</h2>
            <span className="flex flex-wrap gap-2">
              <SyncButtons cap="spools" />
              <AddLink to="/filament/spools/new">{t("filament:spools.add")}</AddLink>
            </span>
          </div>
          {spools.data && !spools.data.total && !Object.keys(spoolQuery).length ? (
            <EmptyState
              icon={SpoolIcon}
              title={t("filament:spools.emptyTitle")}
              description={t("filament:spools.emptyBody")}
            />
          ) : (
            spools.data && (
              <DataTable
                label={t("filament:spools.table")}
                rows={spools.data.items}
                rowKey={(s) => s.id}
                server={{
                  query: spoolQuery,
                  onQueryChange: setSpoolQuery,
                  total: spools.data.total,
                  filters: spoolFilters,
                  defaultSort: "remainingGrams",
                  archivable: true,
                }}
                columns={[
                  {
                    id: "filament",
                    header: t("filament:spools.filament"),
                    cell: (s) => (
                      <span className="flex items-center gap-2">
                        <Swatch hex={s.colorHex} />
                        <Link
                          to="/filament/spools/$id"
                          params={{ id: s.id }}
                          className="font-medium hover:underline"
                        >
                          {spoolName(t, s, profileOf.get(s.profileId))}
                        </Link>
                      </span>
                    ),
                    sort: "filament",
                    filter: "filament",
                  },
                  {
                    id: "remaining",
                    header: t("filament:spools.remaining"),
                    numeric: true,
                    cell: (s) => (
                      <>
                        {s.remainingGrams != null &&
                          s.remainingGrams <= (prefs?.lowSpoolGrams ?? 0) &&
                          s.status !== "empty" && (
                            <span className="mr-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
                              {t("filament:spools.low")}
                            </span>
                          )}
                        {formatWeight(s.remainingGrams)}
                      </>
                    ),
                    sort: "remainingGrams",
                    filter: "remainingGrams",
                  },
                  {
                    id: "status",
                    header: t("filament:spools.status"),
                    cell: (s) => t(STATUS[s.status]),
                    sort: "status",
                    filter: "status",
                    filterOptions: SPOOL_STATUSES.map((v) => ({ value: v, label: t(STATUS[v]) })),
                  },
                  {
                    id: "tags",
                    header: t("tags:column"),
                    cell: (s) => <TagList tags={tagsOf(s.id)} />,
                    filter: "tagId",
                    filterOptions: tags.map((x) => ({ value: x.id, label: x.name })),
                  },
                  {
                    id: "price",
                    header: t("filament:spools.priceColumn"),
                    numeric: true,
                    cell: (s) => {
                      const price = spoolPrice(s);
                      if (price === null) return "";
                      const text = formatCurrency(price / 100, prefs?.currency);
                      // No price paid: estimated from the profile's price per kg.
                      return s.pricePaid === null ? (
                        <span className="text-muted" title={t("filament:spools.listPrice")}>
                          {text}
                        </span>
                      ) : (
                        text
                      );
                    },
                  },
                ]}
              />
            )
          )}
        </section>
      </div>
    </>
  );
}
