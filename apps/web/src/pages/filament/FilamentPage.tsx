import {
  type FilamentProfile,
  filamentProfileFilters,
  SPOOL_STATUSES,
  type Spool,
  spoolFilters,
  spoolPricePerKg,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Spool as SpoolIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagList } from "../../components/TagList.tsx";
import { useFilamentBrands, useFilamentMaterials } from "../../lib/catalog.ts";
import { filamentLabel, useProfiles } from "../../lib/filament.ts";
import { formatCurrency, formatWeight } from "../../lib/format.ts";
import { useAdapterName, useCapable } from "../../lib/integrations.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useTags, useTagsOf } from "../../lib/tags.ts";
import { FilamentCatalog } from "./Catalog.tsx";

export const STATUS = {
  new: "filament:spools.statuses.new",
  in_use: "filament:spools.statuses.in_use",
  empty: "filament:spools.statuses.empty",
} as const;
const addClass =
  "inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";
const importClass =
  "inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";

const AddLink = ({ to, children }: { to: string; children: string }) => (
  <Link to={to} className={addClass}>
    <Plus className="size-4" aria-hidden />
    {children}
  </Link>
);

const label = filamentLabel;

/** One import link per integration that can do it; none = add by hand only. */
function ImportLinks({
  to,
  cap,
  text,
}: {
  to: string;
  cap: "spools" | "filamentProfiles";
  text: string;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  return useCapable(cap).map((i) => (
    <Link key={i.id} to={to} params={{ id: i.id }} className={importClass}>
      {t(text, { name: adapterName(i.adapterId) })}
    </Link>
  ));
}

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
  const [profileQuery, setProfileQuery] = useUrlListQuery("profiles.");
  const spools = useListPage<Spool>(
    ["filament", "spools", "table"],
    "/api/filament/spools",
    spoolQuery,
  );
  const profiles = useListPage<FilamentProfile>(
    ["filament", "profiles", "table"],
    "/api/filament/profiles",
    profileQuery,
  );
  // ponytail: spool labels and prices come from the first 100 active profiles.
  const allProfiles = useProfiles().data?.items;
  const profileOf = new Map(allProfiles?.map((p) => [p.id, p]));
  const brands = useFilamentBrands().data ?? [];
  const materials = useFilamentMaterials().data ?? [];
  const tagsOf = useTagsOf("spool");
  const tags = useTags().data ?? [];
  const spoolPrice = (s: Spool) => {
    const perKg = spoolPricePerKg(s, profileOf.get(s.profileId) ?? { pricePerKg: null });
    return perKg === null ? null : (perKg * s.initialGrams) / 1000;
  };

  return (
    <>
      <PageHeader
        title={t("nav:items.filament.label")}
        description={t("nav:items.filament.description")}
      />
      {(profiles.isError || spools.isError) && (
        <p role="alert" className="text-bad">
          {t("filament:loadError")}
        </p>
      )}
      <div className="grid gap-8">
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("filament:spools.title")}</h2>
            <span className="flex gap-2">
              <ImportLinks
                to="/filament/spools/import/$id"
                cap="spools"
                text="filament:spoolImport.link"
              />
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
                          {label(profileOf.get(s.profileId))}
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
                        {formatWeight(s.remainingGrams)}
                        {s.remainingGrams <= (prefs?.lowSpoolGrams ?? 0) &&
                          s.status !== "empty" && (
                            <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
                              {t("filament:spools.low")}
                            </span>
                          )}
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

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("filament:profiles.title")}</h2>
            <span className="flex gap-2">
              <ImportLinks
                to="/filament/import/$id"
                cap="filamentProfiles"
                text="filament:library.link"
              />
              <AddLink to="/filament/profiles/new">{t("filament:profiles.add")}</AddLink>
            </span>
          </div>
          {profiles.data && (
            <DataTable
              label={t("filament:profiles.table")}
              rows={profiles.data.items}
              rowKey={(p) => p.id}
              server={{
                query: profileQuery,
                onQueryChange: setProfileQuery,
                total: profiles.data.total,
                filters: filamentProfileFilters,
                archivable: true,
              }}
              columns={[
                {
                  id: "name",
                  header: t("filament:spools.filament"),
                  cell: (p) => (
                    <Link
                      to="/filament/profiles/$id"
                      params={{ id: p.id }}
                      className="font-medium hover:underline"
                    >
                      {label(p)}
                    </Link>
                  ),
                  sort: "filament",
                  filter: "filament",
                },
                {
                  id: "brand",
                  header: t("filament:profiles.brand"),
                  cell: (p) => p.brand,
                  sort: "brand",
                  filter: "brandId",
                  filterOptions: brands.map((b) => ({ value: b.id, label: b.name })),
                },
                {
                  id: "material",
                  header: t("filament:profiles.material"),
                  cell: (p) => p.material,
                  sort: "material",
                  filter: "materialId",
                  filterOptions: materials.map((m) => ({ value: m.id, label: m.name })),
                },
                {
                  id: "temps",
                  header: `${t("filament:profiles.nozzleTemp")} / ${t("filament:profiles.bedTemp")}`,
                  cell: (p) =>
                    p.nozzleTempC === null && p.bedTempC === null
                      ? ""
                      : t("filament:profiles.temps", {
                          nozzle: p.nozzleTempC ?? "–",
                          bed: p.bedTempC ?? "–",
                        }),
                },
                {
                  id: "price",
                  header: t("filament:profiles.pricePerKg"),
                  numeric: true,
                  cell: (p) =>
                    p.pricePerKg === null
                      ? ""
                      : formatCurrency(p.pricePerKg / 100, prefs?.currency),
                  sort: "pricePerKg",
                  filter: "pricePerKg",
                  filterScale: 100,
                  filterHint: prefs?.currency,
                },
              ]}
            />
          )}
        </section>
        <FilamentCatalog />
      </div>
    </>
  );
}
