import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useModelInfo } from "../../lib/catalog.ts";
import { formatNumber } from "../../lib/format.ts";
import { useMaintenanceType, usePatchType } from "../../lib/maintenance.ts";
import { usePrinters } from "../../lib/printers.ts";
import { Info, linkButton } from "../filament/SpoolDetailPage.tsx";

export function TypeDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: type, isError } = useMaintenanceType(id);
  const patch = usePatchType();
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const models = useModelInfo();

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("maintenance:types.notFound")}
      </p>
    );
  if (!type) return null;

  const none = t("maintenance:types.none");
  const archived = type.archivedAt !== null;
  const printerNames = printers
    .filter((p) => type.appliesToPrinterIds.includes(p.id))
    .map((p) => p.name);

  return (
    <>
      <PageHeader
        title={type.name}
        description={type.description ?? undefined}
        backTo={{ to: "/maintenance" }}
        actions={
          <>
            <Link to="/maintenance/types/$id/edit" params={{ id }} className={linkButton}>
              {t("maintenance:types.edit")}
            </Link>
            <Button onClick={() => patch.mutate({ id, patch: { archived: !archived } })}>
              {t(archived ? "maintenance:types.restore" : "maintenance:types.archive")}
            </Button>
          </>
        }
      />
      {patch.isError && (
        <p role="alert" className="mb-4 text-bad">
          {t("maintenance:types.error")}
        </p>
      )}
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          {t("maintenance:types.detailTitle")}
          {archived && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
              {t("maintenance:types.archived")}
            </span>
          )}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Info label={t("maintenance:types.hours")}>
            {type.intervalSec === null ? none : formatNumber(type.intervalSec / 3600)}
          </Info>
          <Info label={t("maintenance:types.prints")}>{type.intervalPrints ?? none}</Info>
          <Info label={t("maintenance:types.days")}>{type.intervalDays ?? none}</Info>
          <Info label={t("maintenance:types.model")}>
            {[...type.appliesToModelIds.map((m) => models.get(m)?.label ?? ""), ...printerNames]
              .filter(Boolean)
              .join(", ") || t("maintenance:types.allModels")}
          </Info>
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
