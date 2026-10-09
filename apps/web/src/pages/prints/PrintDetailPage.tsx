import type { PrintDetail } from "@3d-maker-suite/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { CostBreakdown } from "../../components/CostBreakdown.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagList } from "../../components/TagList.tsx";
import { filamentLabel, useProfile, useSpool } from "../../lib/filament.ts";
import { formatDateTime, formatDuration, formatNumber, formatWeight } from "../../lib/format.ts";
import { usePrinter } from "../../lib/printers.ts";
import { useDeletePrint, usePrint } from "../../lib/prints.ts";
import { useProject } from "../../lib/projects.ts";
import { useTagsOf } from "../../lib/tags.ts";
import { Info, linkButton } from "../filament/SpoolDetailPage.tsx";

const OUTCOMES = {
  success: "prints:outcomes.success",
  failed: "prints:outcomes.failed",
  cancelled: "prints:outcomes.cancelled",
} as const;
const link = "font-medium underline";

function PrinterLink({ id }: { id: string }) {
  const name = usePrinter(id).data?.name;
  return (
    <Link to="/printers/$id" params={{ id }} className={link}>
      {name}
    </Link>
  );
}

function ProjectLink({ id }: { id: string }) {
  const name = useProject(id).data?.name;
  return (
    <Link to="/projects/$id" params={{ id }} className={link}>
      {name}
    </Link>
  );
}

function SpoolLink({ id }: { id: string }) {
  const spool = useSpool(id).data;
  const { data: profile } = useProfile(spool?.profileId);
  return (
    <Link to="/filament/spools/$id" params={{ id }} className={link}>
      {filamentLabel(profile)}
    </Link>
  );
}

function Usage({ u }: { u: PrintDetail["usages"][number] }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      {u.spoolId ? (
        <SpoolLink id={u.spoolId} />
      ) : (
        <span>
          {[u.material, u.colorHex].filter(Boolean).join(" ") || t("prints:review.unknown")}
          <span className="ml-2 text-muted">
            {t(u.dismissed ? "prints:detail.untracked" : "prints:detail.waiting")}
          </span>
        </span>
      )}
      <span className="tabular-nums">{formatWeight(u.grams)}</span>
    </li>
  );
}

export function PrintDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: print, isError } = usePrint(id);
  const tagsOf = useTagsOf("print");
  const del = useDeletePrint();
  const [deleting, setDeleting] = useState(false);

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("prints:detail.notFound")}
      </p>
    );
  if (!print) return null;

  const none = t("filament:detail.none");

  return (
    <>
      <PageHeader
        title={print.title}
        description={formatDateTime(print.startedAt)}
        backTo={{ to: "/prints" }}
        actions={
          <>
            <Link to="/prints/$id/edit" params={{ id }} className={linkButton}>
              {t("prints:detail.edit")}
            </Link>
            <Button className="text-bad" onClick={() => setDeleting(true)}>
              {t("prints:detail.delete")}
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold">{t("prints:detail.title")}</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Info label={t("prints:form.printer")}>
              <PrinterLink id={print.printerId} />
            </Info>
            <Info label={t("prints:detail.project")}>
              {print.projectId ? <ProjectLink id={print.projectId} /> : none}
            </Info>
            <Info label={t("prints:form.outcome")}>
              <span className={print.outcome === "success" ? undefined : "text-bad"}>
                {t(OUTCOMES[print.outcome])}
                {print.failureReason && ` · ${print.failureReason}`}
              </span>
            </Info>
            <Info label={t("prints:form.duration")}>
              {print.durationSec == null ? none : formatDuration(print.durationSec)}
            </Info>
            <Info label={t("prints:form.energy")}>
              {print.energyWh == null ? none : formatNumber(print.energyWh)}
            </Info>
            <Info label={t("prints:detail.source")}>
              {print.sourceUrl ? (
                <a href={print.sourceUrl} target="_blank" rel="noreferrer" className={link}>
                  {t("prints:list.openDesign")}
                </a>
              ) : (
                none
              )}
            </Info>
            <Info label={t("tags:column")}>
              <TagList tags={tagsOf(print.id)} />
            </Info>
            <Info label={t("prints:form.notes")}>
              <span className="whitespace-pre-wrap">{print.notes ?? none}</span>
            </Info>
          </dl>
        </section>
        <div className="grid content-start gap-6">
          <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-1 text-base font-semibold">{t("prints:form.filament")}</h2>
            {print.usages.length ? (
              <ul className="divide-y divide-border">
                {print.usages.map((u) => (
                  <Usage key={u.id} u={u} />
                ))}
              </ul>
            ) : (
              <p className="text-muted">{none}</p>
            )}
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold">{t("prints:list.columns.cost")}</h2>
            <CostBreakdown cost={print.cost} />
          </section>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        destructive
        title={t("prints:delete.title")}
        description={t("prints:delete.body", { title: print.title })}
        confirmLabel={t("prints:delete.confirm")}
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          // Leave first: refetching this print after the delete would only 404.
          navigate({ to: "/prints" });
          del.mutate(id);
        }}
      />
    </>
  );
}
