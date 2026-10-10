import {
  IMPORT_COLUMNS,
  IMPORT_ENTITIES,
  type ImportColumn,
  type ImportEntity,
  type ImportResult,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useImportRuns, usePreview, useTemplate } from "../../lib/import.ts";
import { ReviewTable } from "./ReviewTable.tsx";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const ENTITIES: Record<ImportEntity, { label: string; to: string; view: string }> = {
  spools: { label: "import:entities.spools", to: "/filament", view: "import:done.viewSpools" },
  printers: {
    label: "import:entities.printers",
    to: "/printers",
    view: "import:done.viewPrinters",
  },
  prints: { label: "import:entities.prints", to: "/prints", view: "import:done.viewPrints" },
};
const SOURCES = {
  file: "import:history.sources.file",
  zip: "import:history.sources.zip",
  integration: "import:history.sources.integration",
} as const;
const HINTS: Record<ImportColumn["type"], string> = {
  text: "import:hints.text",
  ref: "import:hints.ref",
  number: "import:hints.number",
  integer: "import:hints.integer",
  money: "import:hints.money",
  date: "import:hints.date",
  datetime: "import:hints.datetime",
  color: "import:hints.color",
  enum: "import:hints.enum",
};

export function ImportPage() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<ImportEntity>("spools");
  const [done, setDone] = useState<ImportResult | null>(null);
  const columns: readonly ImportColumn[] = IMPORT_COLUMNS[entity];
  const template = useTemplate(entity);
  const exportFile = useTemplate(entity, "export");
  const runs = useImportRuns();
  const preview = usePreview(entity);
  const labels = Object.fromEntries(columns.map((c) => [c.key, t(c.label)]));
  const name = t(ENTITIES[entity].label);

  const body = {
        labels,
        sheets: {
          data: name,
          lists: t("import:template.lists"),
          instructions: t("import:template.instructions"),
        },
        instructions: [
          [t("import:template.intro")],
          [t("import:template.required")],
          [],
          [t("import:template.column"), t("import:template.format")],
          ...columns.map((c) => [
            `${labels[c.key]}${c.required ? " *" : ""}`,
            t(HINTS[c.type], { options: c.options ?? [] }),
          ]),
        ],
  };
  const downloadTemplate = () =>
    template.mutate({ filename: t("import:template.filename", { name }), body });
  const downloadExport = () =>
    exportFile.mutate({ filename: t("import:export.filename", { name }), body });

  return (
    <>
      <PageHeader title={t("import:title")} description={t("import:description")} />
      <div className="grid gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t("import:entity")}>
            {(p) => (
              <select
                {...p}
                className={inputClass}
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value as ImportEntity);
                  preview.reset();
                }}
              >
                {IMPORT_ENTITIES.map((e) => (
                  <option key={e} value={e}>
                    {t(ENTITIES[e].label)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <Button disabled={template.isPending} onClick={downloadTemplate}>
            {t("import:template.download")}
          </Button>
          <Button disabled={exportFile.isPending} onClick={downloadExport}>
            {t("import:export.download")}
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90 focus-within:outline focus-within:outline-2">
            {t("import:upload.choose")}
            <input
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setDone(null);
                  preview.mutate({ file, labels });
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="text-muted">{t("import:upload.hint")}</p>
        <Link to="/import/slicer-zip" className="w-fit font-medium underline">
          {t("import:zip.link")}
        </Link>

        {(preview.isError || template.isError || exportFile.isError) && (
          <p role="alert" className="text-bad">
            {t(preview.isError ? "import:upload.error" : "import:template.error")}
          </p>
        )}
        {done && (
          <p role="status" className="font-medium text-ok">
            {t("import:done.summary", { created: done.created, updated: done.updated })}{" "}
            <Link to={ENTITIES[entity].to} className="underline">
              {t(ENTITIES[entity].view)}
            </Link>
          </p>
        )}
        {preview.data && (
          <ReviewTable
            key={preview.data.uploadId}
            entity={entity}
            preview={preview.data}
            onCancel={() => preview.reset()}
            onDone={(result) => {
              setDone(result);
              preview.reset();
            }}
          />
        )}
        {!!runs.data?.length && (
          <section className="grid gap-2">
            <h2 className="font-semibold">{t("import:history.title")}</h2>
            <ul className="grid gap-1">
              {runs.data.map((r) => (
                <li key={r.id} className="text-muted">
                  {t("import:history.run", {
                    date: formatDateTime(r.createdAt),
                    type: t(`import:entities.${r.type}`, { defaultValue: r.type }),
                    file: r.fileName ?? t(SOURCES[r.source]),
                    created: r.created,
                    updated: r.updated,
                    skipped: r.skipped,
                    invalid: r.invalid,
                  })}
                  {r.backup && ` · ${t("import:history.backup", { name: r.backup })}`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
