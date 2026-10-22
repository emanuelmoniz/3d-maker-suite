import { IMPORT_ENTITIES, type ImportEntity, type ImportResult } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { usePreview, useTemplate } from "../../lib/import.ts";
import { ExportSection } from "./ExportSection.tsx";
import { ENTITIES, templateBody } from "./entities.ts";
import { ReviewTable } from "./ReviewTable.tsx";

export function ImportPage() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<ImportEntity>("spools");
  const [done, setDone] = useState<ImportResult | null>(null);
  const template = useTemplate(entity);
  const preview = usePreview(entity);
  const body = templateBody(entity, t);
  const name = t(ENTITIES[entity].label);

  return (
    <>
      <PageHeader title={t("import:title")} description={t("import:description")} />
      <div className="grid gap-8">
        <section aria-labelledby="import-title" className="grid gap-4">
          <h2 id="import-title" className="text-lg font-semibold">
            {t("import:import.title")}
          </h2>
          <p className="text-muted">{t("import:import.hint")}</p>

          <div className="grid gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="grid gap-2">
              <h3 className="font-medium">{t("import:import.step1")}</h3>
              <div className="flex flex-wrap items-end gap-3">
                <FormField label={t("import:entity")}>
                  {(p) => (
                    <Combobox
                      {...p}
                      value={entity}
                      onChange={(v) => {
                        setEntity(v as ImportEntity);
                        preview.reset();
                      }}
                      options={IMPORT_ENTITIES.map((e) => ({
                        value: e,
                        label: t(ENTITIES[e].label),
                      }))}
                    />
                  )}
                </FormField>
                <Button
                  disabled={template.isPending}
                  onClick={() =>
                    template.mutate({ filename: t("import:template.filename", { name }), body })
                  }
                >
                  {t("import:template.download")}
                </Button>
              </div>
              <p className="text-muted">{t("import:import.step1Hint")}</p>
            </div>

            <div className="grid gap-2 border-t border-border pt-4">
              <h3 className="font-medium">{t("import:import.step2")}</h3>
              <label className="inline-flex h-9 w-fit cursor-pointer items-center whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90 focus-within:outline-2">
                {t("import:upload.choose")}
                <input
                  type="file"
                  accept=".xlsx,.csv,.json"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setDone(null);
                      preview.mutate({ file, labels: body.labels });
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="text-muted">{t("import:upload.hint")}</p>
            </div>
          </div>

          {(preview.isError || template.isError) && (
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

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="font-medium">{t("import:zip.cardTitle")}</h3>
              <p className="text-muted">{t("import:zip.cardHint")}</p>
            </div>
            <Link
              to="/import/slicer-zip"
              className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2"
            >
              {t("import:zip.link")}
            </Link>
          </div>
        </section>

        <ExportSection />
      </div>
    </>
  );
}
