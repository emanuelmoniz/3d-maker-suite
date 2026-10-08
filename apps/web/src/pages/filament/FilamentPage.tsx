import { type Spool, spoolPricePerKg } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Spool as SpoolIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagFilter } from "../../components/TagFilter.tsx";
import { TagList } from "../../components/TagList.tsx";
import { filamentLabel, usePatchProfile, useProfiles, useSpools } from "../../lib/filament.ts";
import { formatCurrency, formatWeight } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useTagsOf } from "../../lib/tags.ts";
import { AdjustDialog } from "./AdjustDialog.tsx";

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
  const profiles = useProfiles();
  const [tagId, setTagId] = useState("");
  const spools = useSpools(tagId);
  const tagsOf = useTagsOf("spool");
  const patchProfile = usePatchProfile();
  const [adjusting, setAdjusting] = useState<Spool | null>(null);
  const profileOf = new Map(profiles.data?.items.map((p) => [p.id, p]));
  const spoolPrice = (s: Spool) => {
    const perKg = spoolPricePerKg(s, profileOf.get(s.profileId) ?? { pricePerKg: null });
    return perKg === null ? null : (perKg * s.initialGrams) / 1000;
  };
  // Keep the dialog in sync after a save (the list refetches).
  const current = adjusting && (spools.data?.items.find((s) => s.id === adjusting.id) ?? adjusting);

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
              <Link to="/filament/spools/import" className={importClass}>
                {t("filament:spoolImport.link")}
              </Link>
              <AddLink to="/filament/spools/new">{t("filament:spools.add")}</AddLink>
            </span>
          </div>
          <TagFilter value={tagId} onChange={setTagId} />
          {spools.data && !spools.data.items.length && !tagId ? (
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
                columns={[
                  {
                    id: "filament",
                    header: t("filament:spools.filament"),
                    cell: (s) => (
                      <span className="flex items-center gap-2">
                        <Swatch hex={profileOf.get(s.profileId)?.colorHex ?? "#808080"} />
                        <Link
                          to="/filament/spools/$id"
                          params={{ id: s.id }}
                          className="font-medium hover:underline"
                        >
                          {label(profileOf.get(s.profileId))}
                        </Link>
                      </span>
                    ),
                    sortValue: (s) => label(profileOf.get(s.profileId)).toLowerCase(),
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
                    sortValue: (s) => s.remainingGrams,
                  },
                  {
                    id: "status",
                    header: t("filament:spools.status"),
                    cell: (s) => t(STATUS[s.status]),
                    sortValue: (s) => s.status,
                  },
                  {
                    id: "tags",
                    header: t("tags:column"),
                    cell: (s) => <TagList tags={tagsOf(s.id)} />,
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
                    sortValue: (s) => spoolPrice(s) ?? -1,
                  },
                  {
                    id: "action",
                    header: "",
                    cell: (s) => (
                      <Button onClick={() => setAdjusting(s)}>{t("filament:spools.adjust")}</Button>
                    ),
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
              <Link to="/filament/import" className={importClass}>
                {t("filament:library.link")}
              </Link>
              <AddLink to="/filament/profiles/new">{t("filament:profiles.add")}</AddLink>
            </span>
          </div>
          {profiles.data && (
            <DataTable
              label={t("filament:profiles.table")}
              rows={profiles.data.items}
              rowKey={(p) => p.id}
              columns={[
                {
                  id: "name",
                  header: t("filament:spools.filament"),
                  cell: (p) => (
                    <span className="flex items-center gap-2">
                      <Swatch hex={p.colorHex} />
                      <Link
                        to="/filament/profiles/$id"
                        params={{ id: p.id }}
                        className="font-medium hover:underline"
                      >
                        {label(p)}
                      </Link>
                    </span>
                  ),
                  sortValue: (p) => label(p).toLowerCase(),
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
                  sortValue: (p) => p.pricePerKg ?? -1,
                },
                {
                  id: "action",
                  header: "",
                  cell: (p) => (
                    <Button
                      variant="ghost"
                      onClick={() => patchProfile.mutate({ id: p.id, patch: { archived: true } })}
                    >
                      {t("filament:profiles.archive")}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </section>
      </div>
      <AdjustDialog
        spool={current}
        title={label(current ? profileOf.get(current.profileId) : undefined)}
        onClose={() => setAdjusting(null)}
      />
    </>
  );
}
