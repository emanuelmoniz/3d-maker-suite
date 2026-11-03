import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArchiveActions, ArchivedBadge } from "../../components/ArchiveActions.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Write } from "../../components/Write.tsx";
import { formatNumber } from "../../lib/format.ts";
import { useAppliesTo, useMaintenanceType } from "../../lib/maintenance.ts";
import { Info, linkButton } from "../filament/SpoolDetailPage.tsx";

export function TypeDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: type, isError } = useMaintenanceType(id);
  const appliesTo = useAppliesTo();

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("maintenance:types.notFound")}
      </p>
    );
  if (!type) return null;

  const none = t("maintenance:types.none");
  const archived = type.archivedAt !== null;

  return (
    <>
      <PageHeader
        title={type.name}
        description={type.description ?? undefined}
        backTo={{ to: "/maintenance" }}
        actions={
          <Write can="maintenance" level="manage">
            <Link to="/maintenance/types/$id/edit" params={{ id }} className={linkButton}>
              {t("maintenance:types.edit")}
            </Link>
            <ArchiveActions
              path={`/api/maintenance/types/${id}`}
              name={type.name}
              archived={archived}
              onDeleted={() => navigate({ to: "/maintenance" })}
            />
          </Write>
        }
      />
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          {t("maintenance:types.detailTitle")}
          {archived && <ArchivedBadge />}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Info label={t("maintenance:types.hours")}>
            {type.intervalSec === null ? none : formatNumber(type.intervalSec / 3600)}
          </Info>
          <Info label={t("maintenance:types.prints")}>{type.intervalPrints ?? none}</Info>
          <Info label={t("maintenance:types.days")}>{type.intervalDays ?? none}</Info>
          <Info label={t("maintenance:types.appliesTo")}>{appliesTo(type)}</Info>
          {type.docUrl && (
            <Info label={t("maintenance:types.docUrl")}>
              <a href={type.docUrl} target="_blank" rel="noreferrer" className="hover:underline">
                {new URL(type.docUrl).host}
              </a>
            </Info>
          )}
        </dl>
      </section>
    </>
  );
}
