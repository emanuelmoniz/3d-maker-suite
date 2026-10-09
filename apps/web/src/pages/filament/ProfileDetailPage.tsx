import { SPOOL_STATUSES, type Spool, spoolFilters } from "@3d-maker-suite/core";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { filamentLabel, usePatchProfile, useProfile } from "../../lib/filament.ts";
import { formatCurrency, formatNumber, formatWeight } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { STATUS } from "./FilamentPage.tsx";
import { Info, linkButton } from "./SpoolDetailPage.tsx";

export function ProfileDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: profile, isError } = useProfile(id);
  const currency = usePreferences().data?.values.currency;
  const [query, setQuery] = useUrlListQuery();
  const spools = useListPage<Spool>(["filament", "spools", "table"], "/api/filament/spools", {
    ...query,
    profileId: id,
  }).data;
  const patch = usePatchProfile();

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("filament:profileDetail.notFound")}
      </p>
    );
  if (!profile) return null;

  const none = t("filament:detail.none");
  const archived = profile.archivedAt !== null;
  const library = profile.sourcePreset?.split(":")[0];

  return (
    <>
      <PageHeader
        title={filamentLabel(profile)}
        backTo={{ to: "/filament" }}
        actions={
          <>
            <Link to="/filament/profiles/$id/edit" params={{ id }} className={linkButton}>
              {t("filament:detail.edit")}
            </Link>
            <Button onClick={() => patch.mutate({ id, patch: { archived: !archived } })}>
              {t(archived ? "filament:detail.restore" : "filament:profiles.archive")}
            </Button>
          </>
        }
      />
      {patch.isError && (
        <p role="alert" className="mb-4 text-bad">
          {t("filament:profiles.error")}
        </p>
      )}
      <div className="grid gap-6">
        <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            {t("filament:profileDetail.title")}
            {archived && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                {t("filament:detail.archived")}
              </span>
            )}
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Info label={t("filament:profiles.brand")}>{profile.brand || none}</Info>
            <Info label={t("filament:profiles.material")}>{profile.material}</Info>
            <Info label={t("filament:profiles.name")}>{profile.name || none}</Info>
            <Info label={t("filament:profiles.diameter")}>{formatNumber(profile.diameterMm)}</Info>
            <Info label={t("filament:profiles.density")}>{formatNumber(profile.densityGcm3)}</Info>
            <Info label={t("filament:profiles.pricePerKg")}>
              {profile.pricePerKg === null
                ? none
                : formatCurrency(profile.pricePerKg / 100, currency)}
            </Info>
            <Info label={t("filament:profiles.nozzleTemp")}>{profile.nozzleTempC ?? none}</Info>
            <Info label={t("filament:profiles.bedTemp")}>{profile.bedTempC ?? none}</Info>
            {/* Profiles made by a spool import have no preset, so only preset imports show a source. */}
            {library && (
              <Info label={t("filament:detail.source")}>
                {t("filament:detail.imported", {
                  source: t(`filament:library.sources.${library}`),
                })}
              </Info>
            )}
          </dl>
        </section>

        <section className="grid gap-3">
          <h2 className="text-base font-semibold">{t("filament:profileDetail.spools")}</h2>
          {spools && !spools.total && !Object.keys(query).length ? (
            <p className="text-muted">{t("filament:profileDetail.noSpools")}</p>
          ) : (
            spools && (
              <DataTable
                label={t("filament:profileDetail.spools")}
                rows={spools.items}
                rowKey={(s) => s.id}
                server={{
                  query,
                  onQueryChange: setQuery,
                  total: spools.total,
                  filters: spoolFilters,
                  archivable: true,
                }}
                columns={[
                  {
                    id: "remaining",
                    header: t("filament:spools.remaining"),
                    cell: (s) => (
                      <Link
                        to="/filament/spools/$id"
                        params={{ id: s.id }}
                        className="font-medium hover:underline"
                      >
                        {t("filament:spoolImport.remainingOf", {
                          remaining: formatWeight(s.remainingGrams),
                          initial: formatWeight(s.initialGrams),
                        })}
                      </Link>
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
                    id: "location",
                    header: t("filament:spools.location"),
                    cell: (s) => s.location ?? "",
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
