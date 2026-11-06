import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArchiveActions, ArchivedBadge } from "../../components/ArchiveActions.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Write } from "../../components/Write.tsx";
import { filamentLabel, useProfile } from "../../lib/filament.ts";
import { formatNumber } from "../../lib/format.ts";
import { Info, linkButton } from "./SpoolDetailPage.tsx";

export function ProfileDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: profile, isError } = useProfile(id);

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
        backTo={{ to: "/filament/settings" }}
        actions={
          <Write can="catalog" level="manage">
            <Link to="/filament/profiles/$id/edit" params={{ id }} className={linkButton}>
              {t("filament:detail.edit")}
            </Link>
            <ArchiveActions
              path={`/api/filament/profiles/${id}`}
              name={filamentLabel(profile)}
              archived={archived}
              onDeleted={() => navigate({ to: "/filament/settings" })}
            />
          </Write>
        }
      />
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          {t("filament:profileDetail.title")}
          {archived && <ArchivedBadge />}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Info label={t("filament:profiles.brand")}>{profile.brand || none}</Info>
          <Info label={t("filament:profiles.material")}>{profile.material}</Info>
          <Info label={t("filament:profiles.name")}>{profile.name || none}</Info>
          <Info label={t("filament:profiles.diameter")}>{formatNumber(profile.diameterMm)}</Info>
          <Info label={t("filament:profiles.density")}>{formatNumber(profile.densityGcm3)}</Info>
          <Info label={t("filament:profiles.nozzleTemp")}>{profile.nozzleTempC ?? none}</Info>
          <Info label={t("filament:profiles.bedTemp")}>{profile.bedTempC ?? none}</Info>
          {/* Hand-made profiles have no preset, so only preset imports show a source. */}
          {library && (
            <Info label={t("filament:detail.source")}>
              {t("filament:detail.imported", {
                source: t(`filament:library.sources.${library}`),
              })}
            </Info>
          )}
        </dl>
      </section>
    </>
  );
}
