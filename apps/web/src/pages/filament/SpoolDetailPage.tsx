import type { ProjectListItem } from "@3d-maker-suite/core";
import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagList } from "../../components/TagList.tsx";
import { Write } from "../../components/Write.tsx";
import {
  filamentLabel,
  spoolName,
  usePatchSpool,
  useProfile,
  useSpool,
} from "../../lib/filament.ts";
import { formatCurrency, formatDate, formatWeight } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrints } from "../../lib/prints.ts";
import { useTagsOf } from "../../lib/tags.ts";
import { PrintsTable } from "../prints/PrintsPage.tsx";
import { ProjectsTable } from "../projects/ProjectsPage.tsx";
import { AdjustDialog } from "./AdjustDialog.tsx";
import { STATUS, Swatch } from "./FilamentPage.tsx";

export function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export const linkButton =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";

/** The projects and prints that took filament from this spool, as the main lists show them. */
function SpoolUse({ spoolId }: { spoolId: string }) {
  const { t } = useTranslation();
  const [projectQuery, setProjectQuery] = useUrlListQuery("projects.");
  const [printQuery, setPrintQuery] = useUrlListQuery("prints.");
  const projects = useListPage<ProjectListItem>(["projects", "list", "spool"], "/api/projects", {
    ...projectQuery,
    spoolId,
  });
  const prints = usePrints({ ...printQuery, spoolId });
  return (
    <>
      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold">{t("filament:detail.projects")}</h2>
        {projects.data &&
          (projects.data.total || Object.keys(projectQuery).length ? (
            <ProjectsTable
              rows={projects.data.items}
              total={projects.data.total}
              query={projectQuery}
              onQueryChange={setProjectQuery}
            />
          ) : (
            <p className="text-muted">{t("filament:detail.projectsNone")}</p>
          ))}
      </section>
      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold">{t("filament:detail.prints")}</h2>
        {prints.data &&
          (prints.data.total || Object.keys(printQuery).length ? (
            <PrintsTable data={prints.data} query={printQuery} onQueryChange={setPrintQuery} />
          ) : (
            <p className="text-muted">{t("filament:detail.printsNone")}</p>
          ))}
      </section>
    </>
  );
}

export function SpoolDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: spool, isError } = useSpool(id);
  const { data: profile } = useProfile(spool?.profileId);
  const currency = usePreferences().data?.values.currency;
  const tagsOf = useTagsOf("spool");
  const patch = usePatchSpool();
  const [adjusting, setAdjusting] = useState(false);

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("filament:detail.notFound")}
      </p>
    );
  if (!spool) return null;

  const none = t("filament:detail.none");
  const title = spoolName(t, spool, profile);
  const archived = spool.archivedAt !== null;
  const library = spool.sourceSpool?.split(":")[0];

  return (
    <>
      <PageHeader
        title={title}
        description={t(STATUS[spool.status])}
        backTo={{ to: "/filament" }}
        actions={
          <Write>
            <Link to="/filament/spools/$id/edit" params={{ id }} className={linkButton}>
              {t("filament:detail.edit")}
            </Link>
            <Button onClick={() => setAdjusting(true)}>{t("filament:spools.adjust")}</Button>
            <Button onClick={() => patch.mutate({ id, patch: { archived: !archived } })}>
              {t(archived ? "filament:detail.restore" : "filament:spools.archive")}
            </Button>
          </Write>
        }
      />
      {patch.isError && (
        <p role="alert" className="mb-4 text-bad">
          {t("filament:spools.error")}
        </p>
      )}
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Swatch hex={spool.colorHex} />
          {t("filament:detail.title")}
          {archived && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
              {t("filament:detail.archived")}
            </span>
          )}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Info label={t("filament:spools.number")}>{spool.number}</Info>
          <Info label={t("filament:spools.profile")}>
            <Link
              to="/filament/profiles/$id"
              params={{ id: spool.profileId }}
              className="font-medium underline"
            >
              {filamentLabel(profile)}
            </Link>
          </Info>
          <Info label={t("filament:spools.colorName")}>{spool.colorName ?? none}</Info>
          <Info label={t("filament:spools.color")}>{spool.colorHex}</Info>
          <Info label={t("filament:spools.remaining")}>
            {t("filament:spoolImport.remainingOf", {
              remaining: formatWeight(spool.remainingGrams),
              initial: formatWeight(spool.initialGrams),
            })}
          </Info>
          <Info label={t("filament:spools.emptyWeight")}>
            {spool.emptyWeightGrams === null ? none : formatWeight(spool.emptyWeightGrams)}
          </Info>
          <Info label={t("filament:spools.price")}>
            {spool.pricePaid === null ? none : formatCurrency(spool.pricePaid / 100, currency)}
          </Info>
          <Info label={t("filament:spools.location")}>{spool.location ?? none}</Info>
          <Info label={t("filament:spools.purchasedAt")}>
            {spool.purchasedAt ? formatDate(spool.purchasedAt) : none}
          </Info>
          <Info label={t("filament:spools.openedAt")}>
            {spool.openedAt ? formatDate(spool.openedAt) : none}
          </Info>
          <Info label={t("filament:detail.source")}>
            {library
              ? t("filament:detail.imported", { source: t(`filament:library.sources.${library}`) })
              : t("filament:detail.manual")}
          </Info>
          <Info label={t("tags:column")}>
            <TagList tags={tagsOf(spool.id)} />
          </Info>
        </dl>
      </section>
      <SpoolUse spoolId={id} />
      <AdjustDialog
        spool={adjusting ? spool : null}
        title={title}
        onClose={() => setAdjusting(false)}
      />
    </>
  );
}
